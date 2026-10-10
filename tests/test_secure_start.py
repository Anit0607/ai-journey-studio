"""Isolated secure-entry guard checks; no real key prompt is ever used."""
import unittest
import json
from unittest.mock import patch
from scripts import secure_start

class EntryGuards(unittest.TestCase):
    def inherited(self):
        return {
            "PATH":"isolated-node-path", "SYSTEMROOT":"isolated-system-root",
            "TEMP":"isolated-temp",
            "OPENAI_API_KEY":"inherited-openai-fixture",
            "GEMINI_API_KEY":"inherited-gemini-fixture",
            "GOOGLE_API_KEY":"inherited-google-fixture",
            "GOOGLE_APPLICATION_CREDENTIALS":"inherited-google-file-fixture",
            "AZURE_OPENAI_API_KEY":"inherited-azure-fixture",
            "OPENAI_BASE_URL":"https://isolated-wrong-endpoint.test",
            "GEMINI_BASE_URL":"https://isolated-wrong-endpoint.test",
            "STUDIO_RUNTIME_CONFIG":'{"transmission_authorized":true,"openai":{"model":"wrong-inherited-model"}}',
            "DATABASE_URL":"isolated-unused-database-fixture",
            "STUDIO_DATABASE_AUTHORIZED":"1",
            "NODE_OPTIONS":"isolated-injected-option",
            "HTTP_PROXY":"isolated-unused-proxy",
        }
    def run_mocked(self,config,answers):
        captured={}
        def child(command,env):
            captured["command"]=list(command)
            captured["env"]=dict(env)
            return 0
        with patch.object(secure_start.Path,"read_text",return_value=json.dumps(config)),patch.object(secure_start.Path,"exists",return_value=False),patch.object(secure_start.sys.stdin,"isatty",return_value=True),patch.object(secure_start.os,"environ",self.inherited()),patch.object(secure_start.getpass,"getpass",side_effect=answers) as prompt,patch.object(secure_start.subprocess,"call",side_effect=child):
            self.assertEqual(secure_start.launch(),0)
            captured["prompt_count"]=prompt.call_count
        return captured
    def test_missing_authorization_never_prompts(self):
        with patch.object(secure_start.Path,"read_text",return_value='{}'),patch.object(secure_start.getpass,"getpass") as prompt:
            with self.assertRaises(SystemExit):secure_start.launch()
            prompt.assert_not_called()
    def test_skipped_fallback_cannot_inherit_any_provider_alias(self):
        reviewed={"credential_use_authorized":True,"fallback_authorized":True,"transmission_authorized":False,"openai":{"model":"reviewed-fixture"}}
        result=self.run_mocked(reviewed,["fresh-primary-fixture",""])
        child=result["env"]
        self.assertEqual(child["OPENAI_API_KEY"],"fresh-primary-fixture")
        self.assertNotIn("GEMINI_API_KEY",child)
        self.assertEqual(json.loads(child["STUDIO_RUNTIME_CONFIG"]),{**reviewed,"fallback_authorized":False})
        for name in self.inherited():
            if name not in secure_start.OS_ENV_NAMES and name not in {"OPENAI_API_KEY","STUDIO_RUNTIME_CONFIG","STUDIO_DATABASE_AUTHORIZED"}:
                self.assertNotIn(name,child)
        self.assertEqual(child["STUDIO_DATABASE_AUTHORIZED"],"0")
        self.assertEqual(child["PATH"],"isolated-node-path")
        self.assertEqual(child["SYSTEMROOT"],"isolated-system-root")
    def test_unapproved_fallback_never_prompts_or_inherits(self):
        reviewed={"credential_use_authorized":True,"fallback_authorized":False}
        result=self.run_mocked(reviewed,["fresh-primary-fixture"])
        self.assertEqual(result["prompt_count"],1)
        self.assertNotIn("GEMINI_API_KEY",result["env"])
        self.assertEqual(json.loads(result["env"]["STUDIO_RUNTIME_CONFIG"]),reviewed)
    def test_explicit_fallback_uses_only_new_session_key_and_reviewed_config(self):
        reviewed={"credential_use_authorized":True,"fallback_authorized":True,"source_approved":False,"pricing_verified_date":"isolated-date"}
        result=self.run_mocked(reviewed,["fresh-primary-fixture","fresh-fallback-fixture"])
        self.assertEqual(result["env"]["GEMINI_API_KEY"],"fresh-fallback-fixture")
        self.assertEqual(json.loads(result["env"]["STUDIO_RUNTIME_CONFIG"]),reviewed)
        self.assertFalse(any("fixture" in arg for arg in result["command"]))
    def test_filter_does_not_read_unapproved_environment_values(self):
        class NamesOnly(dict):
            def __getitem__(self,name):
                if name not in secure_start.OS_ENV_NAMES:raise AssertionError("Read forbidden inherited value")
                return super().__getitem__(name)
        result=secure_start.session_environment(NamesOnly(self.inherited()))
        self.assertEqual(set(result),{"PATH","SYSTEMROOT","TEMP"})
    def test_dotenv_presence_blocks_prompt_without_reading_contents(self):
        with patch.object(secure_start.Path,"read_text",return_value='{"credential_use_authorized":true}'),patch.object(secure_start.Path,"exists",return_value=True),patch.object(secure_start.sys.stdin,"isatty",return_value=True),patch.object(secure_start.getpass,"getpass") as prompt:
            with self.assertRaises(SystemExit):secure_start.launch()
            prompt.assert_not_called()
    def test_redirected_input_never_prompts(self):
        with patch.object(secure_start.Path,"read_text",return_value='{"credential_use_authorized":true}'),patch.object(secure_start.sys.stdin,"isatty",return_value=False),patch.object(secure_start.getpass,"getpass") as prompt:
            with self.assertRaises(SystemExit):secure_start.launch()
            prompt.assert_not_called()

if __name__=="__main__":unittest.main()
