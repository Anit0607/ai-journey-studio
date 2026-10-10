"""Isolated secure-entry guard checks; no real key prompt is ever used."""
import unittest
from unittest.mock import patch
from scripts import secure_start

class EntryGuards(unittest.TestCase):
    def test_missing_authorization_never_prompts(self):
        with patch.object(secure_start.Path,"read_text",return_value='{}'),patch.object(secure_start.getpass,"getpass") as prompt:
            with self.assertRaises(SystemExit):secure_start.launch()
            prompt.assert_not_called()
    def test_redirected_input_never_prompts(self):
        with patch.object(secure_start.Path,"read_text",return_value='{"credential_use_authorized":true}'),patch.object(secure_start.sys.stdin,"isatty",return_value=False),patch.object(secure_start.getpass,"getpass") as prompt:
            with self.assertRaises(SystemExit):secure_start.launch()
            prompt.assert_not_called()

if __name__=="__main__":unittest.main()
