# fusou CLI flags

The Windows installer registers the `fusou` executable in the `%PATH%`, so you can launch the app or query metadata directly from a terminal. The following flags mirror the CLI behavior implemented in `src-tauri`.

## Global flags

| Flag | Description |
| --- | --- |
| `-V`, `--version` | Prints the human-readable product name and version, then exits without launching the UI. |
| `-l`, `--logs` | Attaches the process to the invoking terminal (or allocates a new console window on Windows) so that runtime logs stream to `stdout`. Use this when you want to monitor tracing output while the UI is running. |

Global flags can be combined with subcommands. For example, `fusou --logs info` prints metadata and keeps the console available for subsequent runs.

## Subcommands

### `info`

Prints detailed metadata about the current installation, such as the identifier, resolved executable path, resource directory, and config directories.

`info` accepts one optional flag:

| Flag | Description |
| --- | --- |
| `--json` | Emits the same metadata as pretty-printed JSON. Useful for scripting or diagnostics. |

## Usage examples

```powershell
# Check the installed version
fusou --version

# Inspect install metadata as JSON
fusou info --json

# Start the UI but mirror logs to the current terminal session
fusou --logs
```

## Notes

- `--logs` only controls console attachment. The UI still launches normally; closing the GUI terminates the process and returns you to the shell.
- `info` and `--version` exit immediately after printing their output. Combine them with `--logs` only when you also plan to start the app afterwards.
- If you launch `fusou --logs` from the Windows Start menu or Explorer (without an existing terminal), Windows automatically opens a new console window to host the log stream.
