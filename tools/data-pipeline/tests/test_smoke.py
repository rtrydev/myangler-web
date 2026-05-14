"""Smoke tests for the data-pipeline scaffold.

These exist to catch breakage of the basics: the package imports, the CLI
parses arguments, and the JSONL reader behaves correctly on tiny inputs.
Real pipeline-step behavior is tested as each step is implemented.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


def test_package_imports() -> None:
    import data_pipeline  # noqa: F401
    from data_pipeline import cli, config, io  # noqa: F401

    assert data_pipeline.__version__


def test_cli_help_exits_cleanly() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "data_pipeline", "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    out = result.stdout
    # Every pipeline subcommand plus `all` must show up in --help.
    for sub in (
        "load",
        "strip",
        "index-en",
        "merge-g2p",
        "build-db",
        "convert-ngram",
        "bktree-en",
        "bktree-my",
        "version",
        "report",
        "all",
    ):
        assert sub in out, f"subcommand {sub!r} missing from --help output"


def test_jsonl_reader_parses_and_skips_malformed(tmp_path: Path) -> None:
    from data_pipeline.io import ReadStats, iter_jsonl

    fixture = tmp_path / "sample.jsonl"
    fixture.write_text(
        '{"word": "က", "lang": "Burmese"}\n'
        "\n"  # blank lines are silently ignored
        "{this is not valid json}\n"
        '{"word": "ခ", "lang": "Burmese"}\n',
        encoding="utf-8",
    )

    stats = ReadStats()
    entries = list(iter_jsonl(fixture, stats=stats))

    assert [e["word"] for e in entries] == ["က", "ခ"]
    assert stats.parsed == 2
    assert stats.skipped == 1


def test_load_subcommand_reports_counts(tmp_path: Path) -> None:
    fixture = tmp_path / "tiny.jsonl"
    fixture.write_text(
        '{"word": "a"}\n'
        "not json\n"
        '{"word": "b"}\n',
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "data_pipeline",
            "--input",
            str(fixture),
            "--output-dir",
            str(tmp_path / "build"),
            "load",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "parsed:  2" in result.stdout
    assert "skipped: 1" in result.stdout


def test_stub_subcommand_succeeds_and_creates_output_dir(tmp_path: Path) -> None:
    # merge-g2p and convert-ngram remain stubs in this task and do not
    # require a real input file.
    out_dir = tmp_path / "build"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "data_pipeline",
            "--input",
            str(tmp_path / "ignored.jsonl"),
            "--output-dir",
            str(out_dir),
            "merge-g2p",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert out_dir.is_dir()


def test_missing_input_file_for_load_returns_error(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "data_pipeline",
            "--input",
            str(tmp_path / "does-not-exist.jsonl"),
            "--output-dir",
            str(tmp_path / "build"),
            "load",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1


@pytest.mark.parametrize(
    "field_name, expected_type",
    [
        ("DEFAULT_INPUT_PATH", Path),
        ("DEFAULT_OUTPUT_DIR", Path),
        ("FUZZY_THRESHOLD_EN", int),
        ("FUZZY_THRESHOLD_MY", int),
    ],
)
def test_config_exposes_expected_constants(field_name: str, expected_type: type) -> None:
    from data_pipeline import config

    assert hasattr(config, field_name), f"config missing {field_name}"
    assert isinstance(getattr(config, field_name), expected_type)
