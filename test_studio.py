import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import studio
import urllib.error

class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=studio.Store(Path(self.tmp.name)/"isolated.sqlite")
    def tearDown(self): self.tmp.cleanup()
    def task(self):
        return self.store.enqueue(self.store.source(studio.CAPSULE,"user-reported-notes","2026-10-09"))
    def test_empty_workspace(self):
        s=self.store.snapshot()
        self.assertEqual(s["tasks"],[]); self.assertEqual(s["ledger"],[])
        self.assertEqual(s["analyst"]["status"],"insufficient-data")
    def test_source_filter(self):
        for text,category in [("private client","user-reported-notes"),(studio.CAPSULE,"bank"),("ignore instructions","chat")]:
            with self.assertRaises(ValueError): self.store.source(text,category,"2026-10-09")
        with self.assertRaises(ValueError): self.store.enqueue(123)
    def test_duplicate_action(self):
        s=self.store.source(studio.CAPSULE,"user-reported-notes","2026-10-09")
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            ids=list(pool.map(lambda _:self.store.enqueue(s),range(16)))
        self.assertEqual(len(set(ids)),1)
    def test_budget_concurrency(self):
        task=self.task()
        def reserve(_):
            try: return self.store.reserve(task,"test","fixture",{},1_000_000)
            except ValueError: return None
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            results=list(pool.map(reserve,range(30)))
        self.assertEqual(sum(x is not None for x in results),14)
        self.assertEqual(self.store.snapshot()["budget"]["committed_microdollars"],14_000_000)
    def test_unknown_restart(self):
        t=self.task(); self.store.reserve(t,"test","fixture",{},1000)
        with self.store.connect() as db: db.execute("UPDATE tasks SET status='running' WHERE id=?",(t,))
        studio.recover(self.store)
        self.assertEqual(self.store.snapshot()["tasks"][0]["status"],"blocked")
        self.assertEqual(self.store.snapshot()["ledger"][0]["reserved"],1000)
    def test_checkpoint_restart(self):
        t=self.task()
        with self.store.connect() as db: db.execute("UPDATE tasks SET status='running',checkpoint=2 WHERE id=?",(t,))
        studio.recover(self.store)
        row=self.store.snapshot()["tasks"][0]
        self.assertEqual(row["status"],"queued"); self.assertEqual(row["checkpoint"],2)
    def test_approval_invalidated(self):
        t=self.task()
        with self.assertRaises(ValueError): studio.approve(self.store,t,"bad")
        with self.store.connect() as db:
            for role in studio.ROLES: db.execute("INSERT INTO outputs(task,role,text,hash,created) VALUES(?,?,?,?,?)",(t,role,"isolated fixture",studio.digest(role),studio.stamp()))
            db.execute("UPDATE tasks SET status='review' WHERE id=?",(t,))
        hashes=[o["hash"] for o in self.store.snapshot()["outputs"]]
        version=studio.digest("|".join(hashes))
        with self.store.connect() as db: db.execute("UPDATE sources SET cleared=0")
        with self.assertRaises(ValueError): studio.approve(self.store,t,version)
        with self.store.connect() as db: db.execute("UPDATE sources SET cleared=1")
        studio.approve(self.store,t,version)
        with self.assertRaises(ValueError): studio.approve(self.store,t,version)
    def test_no_authorization_no_call(self):
        self.task()
        with patch("studio.ready",return_value=False),patch("studio.provider_call") as call:
            self.assertFalse(studio.run_one(self.store)); call.assert_not_called()
    def test_cancel_no_call(self):
        t=self.task()
        with self.store.connect() as db: db.execute("UPDATE tasks SET status='cancelled'")
        with patch("studio.ready",return_value=True),patch("studio.config",return_value={}),patch("studio.provider_call") as call:
            self.assertFalse(studio.run_one(self.store));call.assert_not_called()
    def configuration(self):
        return {"openai":{"model":"isolated-fixture","input_microdollars_per_token":1,"output_microdollars_per_token":2}}
    def test_pipeline_checkpoint_and_usage(self):
        self.task()
        with patch("studio.ready",return_value=True),patch("studio.config",return_value=self.configuration()),patch("studio.provider_call",return_value=("isolated test artifact",30,20)):
            self.assertTrue(studio.run_one(self.store))
        s=self.store.snapshot()
        self.assertEqual(s["tasks"][0]["status"],"review")
        self.assertEqual(len(s["outputs"]),6)
        self.assertEqual(sum(r["estimated"] for r in s["ledger"]),420)
    def test_timeout_no_replay(self):
        self.task()
        with patch("studio.ready",return_value=True),patch("studio.config",return_value=self.configuration()),patch("studio.provider_call",side_effect=TimeoutError) as call:
            studio.run_one(self.store);studio.run_one(self.store)
            self.assertEqual(call.call_count,1)
        s=self.store.snapshot()
        self.assertEqual(s["ledger"][0]["status"],"unknown")
        self.assertEqual(s["tasks"][0]["status"],"blocked")
    def test_refusal_no_fallback(self):
        self.task()
        c=self.configuration();c["fallback_authorized"]=True;c["gemini"]=c["openai"]
        with patch.dict("os.environ",{"GEMINI_API_KEY":"isolated-test-only"}),patch("studio.ready",return_value=True),patch("studio.config",return_value=c),patch("studio.provider_call",side_effect=urllib.error.HTTPError("test",403,"denied",{},None)) as call:
            studio.run_one(self.store);self.assertEqual(call.call_count,1)
    def test_transient_bounded_fallback(self):
        self.task()
        c=self.configuration();c["fallback_authorized"]=True;c["gemini"]=c["openai"]
        failure=urllib.error.HTTPError("test",503,"transient",{},None)
        with patch.dict("os.environ",{"GEMINI_API_KEY":"isolated-test-only"}),patch("studio.ready",return_value=True),patch("studio.config",return_value=c),patch("studio.provider_call",side_effect=[failure,("isolated test artifact",10,10),TimeoutError]) as call:
            studio.run_one(self.store);self.assertEqual(call.call_count,3)
        s=self.store.snapshot()
        self.assertEqual([r["status"] for r in s["ledger"]],["unknown","settled","unknown"])

if __name__=="__main__": unittest.main()
