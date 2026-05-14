"""Per-step modules for the data pipeline.

Each pipeline step from spec §6 will get its own module here as it is
implemented. At the scaffold stage every step is a logging-only stub
declared inline in ``data_pipeline.cli``; once real work begins, move
each stub into ``steps/<name>.py`` and import it from the CLI.
"""
