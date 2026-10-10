"""User-operated, memory-only provider key entry for the web app; never run by an agent."""
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import warnings

def launch():
    try:
        config=json.loads(Path("runtime-config.json").read_text())
    except (OSError,ValueError):
        raise SystemExit("Reviewed local consent/pricing configuration required before key entry")
    if not config.get("credential_use_authorized"):
        raise SystemExit("Credential-use authorization is required before key entry")
    if not sys.stdin.isatty():
        raise SystemExit("Interactive user terminal required; redirected entry refused")
    environment=dict(os.environ)
    with warnings.catch_warnings():
        warnings.simplefilter("error",getpass.GetPassWarning)
        try:
            primary=getpass.getpass("OpenAI API key (hidden; this web session only): ").strip()
            if not primary:raise SystemExit("No key entered")
            environment["OPENAI_API_KEY"]=primary
            if config.get("fallback_authorized"):
                fallback=getpass.getpass("Gemini API key (hidden; Enter to skip): ").strip()
                if fallback:environment["GEMINI_API_KEY"]=fallback
        except getpass.GetPassWarning:
            raise SystemExit("Secure hidden entry unavailable; nothing persisted")
    # Child-only environment, not persistent user/machine environment. No secret arguments.
    command=["node",str(Path("node_modules/tsx/dist/cli.mjs").resolve()),"scripts/local.ts","dev"]
    try:
        return subprocess.call(command,env=environment)
    finally:
        environment.pop("OPENAI_API_KEY",None)
        environment.pop("GEMINI_API_KEY",None)

if __name__=="__main__":raise SystemExit(launch())
