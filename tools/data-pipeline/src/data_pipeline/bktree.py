"""Generic BK-tree (spec §2.5).

A BK-tree organizes points in a metric space so that range queries
("find everything within distance ``k`` of ``q``") can prune large
subtrees. The distance function is supplied by the caller, so the same
tree implementation backs:

  - the English BK-tree (character-level Levenshtein over gloss-words), and
  - the Burmese BK-tree (syllable-level Levenshtein over headword
    syllable sequences).

Serialization
-------------
:meth:`BKTree.to_json_obj` returns a plain ``dict`` ready for
``json.dump``. The format is intentionally simple and documented in the
``data-pipeline`` README; the frontend re-hydrates it into a tree
identical to the Python build.
"""

from __future__ import annotations

from collections.abc import Callable, Hashable, Iterable
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

T = TypeVar("T", bound=Hashable)
DistanceFn = Callable[[Any, Any], int]


def edit_distance(a: str, b: str) -> int:
    """Classic Levenshtein distance over sequences.

    Works for any pair of indexable, equality-comparable sequences — so
    the same routine handles ``str`` (character-level) and ``tuple[str, ...]``
    (syllable-level) the same way.
    """
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    # Two-row DP; keep the previous row only.
    prev = list(range(lb + 1))
    curr = [0] * (lb + 1)
    for i in range(1, la + 1):
        curr[0] = i
        ai = a[i - 1]
        for j in range(1, lb + 1):
            cost = 0 if ai == b[j - 1] else 1
            curr[j] = min(
                prev[j] + 1,         # deletion
                curr[j - 1] + 1,     # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev, curr = curr, prev
    return prev[lb]


@dataclass
class _Node(Generic[T]):
    value: T
    # children keyed by distance from this node's value to the child's value.
    children: dict[int, _Node[T]] = field(default_factory=dict)


class BKTree(Generic[T]):
    """A BK-tree over hashable keys ``T`` with a caller-supplied distance.

    The tree stores each unique key once (duplicates are silently ignored).
    Use :meth:`query` to retrieve every key within ``threshold`` of a probe
    key; results are ``(key, distance)`` pairs sorted by distance.
    """

    def __init__(self, distance: DistanceFn) -> None:
        self._distance = distance
        self._root: _Node[T] | None = None
        self._size = 0

    def __len__(self) -> int:
        return self._size

    @property
    def root(self) -> _Node[T] | None:
        return self._root

    def insert(self, value: T) -> None:
        if self._root is None:
            self._root = _Node(value=value)
            self._size = 1
            return

        node = self._root
        while True:
            if value == node.value:
                # Duplicate: skip.
                return
            d = self._distance(value, node.value)
            child = node.children.get(d)
            if child is None:
                node.children[d] = _Node(value=value)
                self._size += 1
                return
            node = child

    def insert_many(self, values: Iterable[T]) -> None:
        for v in values:
            self.insert(v)

    def query(self, probe: T, threshold: int) -> list[tuple[T, int]]:
        if self._root is None:
            return []
        results: list[tuple[T, int]] = []
        stack: list[_Node[T]] = [self._root]
        while stack:
            node = stack.pop()
            d = self._distance(probe, node.value)
            if d <= threshold:
                results.append((node.value, d))
            lo, hi = d - threshold, d + threshold
            for edge, child in node.children.items():
                if lo <= edge <= hi:
                    stack.append(child)
        results.sort(key=lambda item: (item[1], item[0]))
        return results

    # --- Serialization ------------------------------------------------------

    def to_json_obj(self) -> dict[str, Any]:
        """Return a JSON-serializable representation of the tree.

        Flat layout, versioned via ``"format"``::

            {
              "format": "bktree/v1",
              "size":   <int>,
              "root":   <int> | null,         # index into "nodes", or null when empty
              "nodes":  [<value>, ...],       # node values, addressed by index
              "edges":  [{<distance>: <child_idx>, ...}, ...]  # parallel to "nodes"
            }

        Edge keys are stringified ints (JSON object keys are strings) — the
        frontend parses them back to integers on load.

        A flat representation avoids the recursion limit / quadratic-stack
        issues a nested representation hits on trees built from ~8k
        Burmese headwords (depth can exceed 1300 levels). Frontend loaders
        can rebuild the tree in one linear pass.
        """
        if self._root is None:
            return {
                "format": "bktree/v1",
                "size": 0,
                "root": None,
                "nodes": [],
                "edges": [],
            }

        # BFS over the tree assigns indices.
        values: list[Any] = []
        edges: list[dict[str, int]] = []
        # (node, assigned_index) pairs.
        index_of: dict[int, int] = {id(self._root): 0}
        values.append(self._root.value)
        edges.append({})
        queue: list[_Node[T]] = [self._root]
        head = 0
        while head < len(queue):
            node = queue[head]
            head += 1
            parent_idx = index_of[id(node)]
            for d, child in node.children.items():
                child_idx = len(values)
                values.append(child.value)
                edges.append({})
                edges[parent_idx][str(d)] = child_idx
                index_of[id(child)] = child_idx
                queue.append(child)

        return {
            "format": "bktree/v1",
            "size": self._size,
            "root": 0,
            "nodes": values,
            "edges": edges,
        }

    @classmethod
    def from_json_obj(cls, data: dict[str, Any], distance: DistanceFn) -> BKTree[Any]:
        """Round-trip for tests; the frontend uses its own loader."""
        if data.get("format") != "bktree/v1":
            raise ValueError(f"unknown BK-tree format: {data.get('format')!r}")
        tree: BKTree[Any] = cls(distance)
        raw_root_idx = data.get("root")
        if raw_root_idx is None:
            return tree

        def coerce(value: Any) -> Any:
            return tuple(value) if isinstance(value, list) else value

        values = data["nodes"]
        edges = data["edges"]
        # First pass: materialize one _Node per stored value.
        nodes: list[_Node[Any]] = [_Node(value=coerce(v)) for v in values]
        # Second pass: wire up children using the recorded edges.
        for parent_idx, child_map in enumerate(edges):
            parent = nodes[parent_idx]
            for d_str, child_idx in child_map.items():
                parent.children[int(d_str)] = nodes[child_idx]

        tree._root = nodes[int(raw_root_idx)]
        tree._size = int(data.get("size", len(values)))
        return tree
