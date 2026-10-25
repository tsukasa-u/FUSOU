export function publicToolEnvironment(environment) {
  const result = {};
  for (const name of ["PATH", "HOME", "USER", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot",
    "TMP", "TEMP", "TMPDIR", "RUSTUP_HOME", "CARGO_HOME", "CARGO_NET_OFFLINE", "RUSTUP_AUTO_INSTALL"]) {
    if (environment[name] !== undefined) result[name] = environment[name];
  }
  return result;
}
