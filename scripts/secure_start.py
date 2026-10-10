"""User-operated, memory-only provider key entry for the web app; never run by an agent."""
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import warnings

# Only platform/runtime necessities are inherited. In particular, do not even
# read values for provider aliases, config overrides, proxies, NODE_OPTIONS,
# database URLs or other application settings.
OS_ENV_NAMES = (
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC",
    "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
    "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
    "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "COLORTERM",
)

def session_environment(inherited):
    return {name: inherited[name] for name in OS_ENV_NAMES if name in inherited}

def launch():
    try:
        config=json.loads(Path("runtime-config.json").read_text())
    except (OSError,ValueError):
        raise SystemExit("Reviewed local consent/pricing configuration required before key entry")
    if not isinstance(config,dict) or not config.get("credential_use_authorized"):
        raise SystemExit("Credential-use authorization is required before key entry")
    if not sys.stdin.isatty():
        raise SystemExit("Interactive user terminal required; redirected entry refused")
    if any(Path(name).exists() for name in (".env",".env.local",".env.development",".env.development.local")):
        raise SystemExit("Session-only entry requires a checkout without .env files; no contents were read")
    environment=session_environment(os.environ)
    # Snapshot the exact reviewed file. Next must never re-read a changed file
    # or accept an inherited STUDIO_RUNTIME_CONFIG in this entry path.
    session_config=json.loads(json.dumps(config))
    with warnings.catch_warnings():
        warnings.simplefilter("error",getpass.GetPassWarning)
        try:
            primary=getpass.getpass("OpenAI API key (hidden; this web session only): ").strip()
            if not primary:raise SystemExit("No key entered")
            environment["OPENAI_API_KEY"]=primary
            if config.get("fallback_authorized"):
                fallback=getpass.getpass("Gemini API key (hidden; Enter to skip): ").strip()
                if fallback:environment["GEMINI_API_KEY"]=fallback
                else:session_config["fallback_authorized"]=False
            else:session_config["fallback_authorized"]=False
        except getpass.GetPassWarning:
            raise SystemExit("Secure hidden entry unavailable; nothing persisted")
    environment["STUDIO_RUNTIME_CONFIG"]=json.dumps(session_config,separators=(",",":"))
    environment["STUDIO_DATABASE_AUTHORIZED"]="0"
    environment["STUDIO_SESSION_ONLY"]="1"
    # Child-only environment, not persistent user/machine environment. No secret arguments.
    command=["node",str(Path("node_modules/tsx/dist/cli.mjs").resolve()),"scripts/local.ts","dev","--session-only","--pilot"]
    try:
        return subprocess.call(command,env=environment)
    finally:
        environment.pop("OPENAI_API_KEY",None)
        environment.pop("GEMINI_API_KEY",None)

if __name__=="__main__":raise SystemExit(launch())
