"""Read-only local server authorization smoke check. No source/task writes."""
import subprocess
import urllib.request
import urllib.error
import json
import sys
p=subprocess.Popen([sys.executable,"studio.py","serve","--port","8766"],stdout=subprocess.PIPE,text=True)
try:
    line=p.stdout.readline()
    token=line.strip().split(": ")[-1]
    assert urllib.request.urlopen("http://127.0.0.1:8766").status==200
    try:
        urllib.request.urlopen("http://127.0.0.1:8766/api/state")
        raise AssertionError("Unauthorized state access")
    except urllib.error.HTTPError as e: assert e.code==401
    req=urllib.request.Request("http://127.0.0.1:8766/api/state",headers={"Authorization":"Bearer "+token})
    state=json.load(urllib.request.urlopen(req))
    assert state["tasks"]==[] and state["ledger"]==[] and not state["live_enabled"]
    req=urllib.request.Request("http://127.0.0.1:8766/api/run",data=b'{"source":1}',headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        urllib.request.urlopen(req);raise AssertionError("Missing Origin accepted")
    except urllib.error.HTTPError as e: assert e.code==403
    print("PASS: dashboard HTTP, empty actual state, authorization, cross-origin mutation rejection")
finally:
    p.terminate();p.wait(timeout=10)
