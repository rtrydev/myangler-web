// Orchestrator configuration knobs.
//
// Centralized to mirror the sibling `app/lib/lookup` and
// `app/lib/segmenter` modules' pattern. Keep this small: configuration
// for hypothetical future requirements does not belong here.

export interface SearchConfig {
  /** Hard upper bound on input length (codepoints), enforced before any
   *  engine work. Spec §2.1 pegs the user-facing ceiling at ~500
   *  characters; the exact value is intended to be tunable. */
  maxInputLength: number;
}

export const DEFAULT_CONFIG: SearchConfig = {
  maxInputLength: 500,
};
