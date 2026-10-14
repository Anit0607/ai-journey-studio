"""Owner-entry checks with dummy inputs and mocked DB/hash dependencies only.

Run with: python -m unittest discover -s tests -p test_owner_password_setup.py -v
No real password prompt, credential environment, database, or network is used.
"""
import contextlib
import getpass
import json
from pathlib import Path
import shutil
import subprocess
import unittest
import warnings
from unittest.mock import patch

from scripts import set_owner_password


ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "inert-owner-password-fixture"
REMOTE = "postgresql://dummy:dummy@ep-fixture.neon.tech/fixture?sslmode=require"
OS_NAMES = {
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME",
}


class HiddenEntryTests(unittest.TestCase):
    def invoke(self, args=(), answers=(), *, tty=True, environment=None, child_code=0, child_error=None):
        captured = {}

        def child(command, **kwargs):
            captured.update(command=list(command), **kwargs)
            if child_error:
                raise child_error
            return subprocess.CompletedProcess(command, child_code)

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(set_owner_password.sys, "argv", ["set_owner_password.py", *args]))
            stack.enter_context(patch.object(set_owner_password.sys.stdin, "isatty", return_value=tty))
            stack.enter_context(patch.object(set_owner_password.os, "environ", environment or {}))
            prompt = stack.enter_context(patch.object(set_owner_password.getpass, "getpass", side_effect=answers))
            spawn = stack.enter_context(patch.object(set_owner_password.subprocess, "run", side_effect=child))
            try:
                captured["returncode"] = set_owner_password.main()
            except SystemExit as error:
                captured["error"] = str(error)
            captured["prompt_count"] = prompt.call_count
            captured["spawn_count"] = spawn.call_count
        return captured

    def test_missing_authorization_stops_before_prompt(self):
        result = self.invoke()
        self.assertIn("required", result["error"])
        self.assertEqual((result["prompt_count"], result["spawn_count"]), (0, 0))

    def test_redirected_input_stops_before_prompt(self):
        result = self.invoke(["--owner-setup-authorized"], tty=False)
        self.assertIn("hidden input", result["error"])
        self.assertEqual((result["prompt_count"], result["spawn_count"]), (0, 0))

    def test_remote_requires_separate_migration_authorization(self):
        result = self.invoke(["--owner-setup-authorized", "--remote"])
        self.assertIn("separate", result["error"])
        self.assertEqual((result["prompt_count"], result["spawn_count"]), (0, 0))

    def test_mismatch_is_private_and_never_starts_child(self):
        result = self.invoke(["--owner-setup-authorized"], [PASSWORD, "different-inert-fixture"])
        self.assertIn("did not match", result["error"])
        self.assertNotIn(PASSWORD, result["error"])
        self.assertEqual(result["spawn_count"], 0)

    def test_hidden_input_warning_is_fatal_before_echo_fallback(self):
        def cannot_hide(*_):
            warnings.warn("inert warning", getpass.GetPassWarning)
            self.fail("Visible fallback must not be reached")

        result = self.invoke(["--owner-setup-authorized"], cannot_hide)
        self.assertIn("Hidden input unavailable", result["error"])
        self.assertEqual(result["spawn_count"], 0)

    def test_cancelled_or_exhausted_hidden_input_never_starts_child(self):
        for error in (EOFError("inert-private-fixture"), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                result = self.invoke(["--owner-setup-authorized"], error)
                self.assertIn("cancelled", result["error"])
                self.assertNotIn("inert-private-fixture", result["error"])
                self.assertEqual(result["spawn_count"], 0)

    def test_subprocess_launch_failures_are_sanitized(self):
        for error in (OSError("inert-private-fixture"), subprocess.SubprocessError("inert-private-fixture")):
            with self.subTest(error=type(error).__name__):
                result = self.invoke(["--owner-setup-authorized"], [PASSWORD, PASSWORD], child_error=error)
                self.assertIn("did not complete", result["error"])
                self.assertNotIn("inert-private-fixture", result["error"])

    def test_local_child_gets_only_stdin_secret_and_explicit_local_environment(self):
        result = self.invoke(["--owner-setup-authorized"], [PASSWORD, PASSWORD], child_code=7)
        self.assertEqual(json.loads(result["input"]), {"password": PASSWORD, "database_url": ""})
        self.assertEqual(result["env"], {"STUDIO_LOCAL_DB": "1", "STUDIO_DATABASE_AUTHORIZED": "0"})
        self.assertEqual(result["cwd"], ROOT)
        self.assertTrue(result["text"])
        self.assertEqual(result["returncode"], 7)
        self.assertNotIn(PASSWORD, json.dumps(result["command"]))
        self.assertIn("--owner-setup-authorized", result["command"])
        self.assertNotIn("--remote", result["command"])

    def test_remote_child_receives_explicit_flags_and_stdin_only(self):
        result = self.invoke(
            ["--owner-setup-authorized", "--remote", "--migrate-authorized"],
            [REMOTE, PASSWORD, PASSWORD],
        )
        self.assertEqual(json.loads(result["input"]), {"password": PASSWORD, "database_url": REMOTE})
        self.assertEqual(result["env"], {})
        self.assertEqual(result["prompt_count"], 3)
        self.assertEqual(result["command"][-2:], ["--remote", "--migrate-authorized"])
        for value in (PASSWORD, REMOTE):
            self.assertNotIn(value, json.dumps(result["command"]))

    def test_scrubbing_does_not_even_read_forbidden_environment_values(self):
        class GuardedEnvironment(dict):
            def __getitem__(self, key):
                if key not in OS_NAMES:
                    raise AssertionError("A forbidden inherited value was read")
                return super().__getitem__(key)

        inherited = GuardedEnvironment({
            **{name: "inert-os-fixture" for name in OS_NAMES},
            **{name: "must-not-read-fixture" for name in (
                "OPENAI_API_KEY", "GEMINI_API_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED",
                "STUDIO_DATABASE_AUTHORIZED", "STUDIO_RUNTIME_CONFIG", "STUDIO_LOCAL_PATH",
                "STUDIO_AUTH_SECRET", "PGPASSWORD", "PGHOST", "PGSSLMODE", "NODE_OPTIONS",
                "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "VERCEL",
            )},
        })
        result = self.invoke(["--owner-setup-authorized"], [PASSWORD, PASSWORD], environment=inherited)
        self.assertEqual(set(result["env"]), OS_NAMES | {"STUDIO_LOCAL_DB", "STUDIO_DATABASE_AUTHORIZED"})
        self.assertEqual(result["env"]["STUDIO_DATABASE_AUTHORIZED"], "0")


# Execute the actual helper body with imports replaced by inert fixture methods.
# Native Node TypeScript stripping avoids loading the application's dependency tree.
# provisionOwner itself is loaded with all imports removed and a dummy hash function,
# so its existing-owner guard is exercised without any real crypto/DB operation.
NODE_HARNESS = r"""
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const root=process.argv[1], fixture=JSON.parse(process.argv[2]);
const trace={calls:[],sql:[],urls:[],hashCalls:0,uncaught:null};
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const withoutImports=source=>source.replace(/^import .*;\r?\n/gm,'');
const compile=source=>stripTypeScriptTypes(source,{mode:'strip'});
process.env=fixture.environment||{};
process.argv=['node','owner-password-setup.ts',...(fixture.flags||[])];
globalThis.__hashFixture=async()=>{trace.hashCalls++;return 'inert-salted-hash-fixture';};
const ownerSource='const hashPassword=globalThis.__hashFixture;\n'+withoutImports(readFileSync(root+'/lib/owner-password.ts','utf8'));
const owner=await import(moduleUrl(compile(ownerSource)));
const db={kind:'pglite',async query(sql){trace.sql.push(sql);return sql==='SELECT id FROM studio_auth_user'&&fixture.existingOwner?[{id:'studio-owner'}]:[];},
 async transaction(work){trace.calls.push('transaction');if(fixture.transactionError)throw Error(fixture.transactionError);return work(db);},
 async close(){trace.calls.push('close');if(fixture.closeError)throw Error(fixture.closeError);}};
globalThis.__setupFixture={...owner,SCHEMA:'INERT_SCHEMA_FIXTURE',
 async database(){const mode=process.env.STUDIO_LOCAL_DB==='1'&&!process.env.VERCEL?'pglite':process.env.STUDIO_DATABASE_AUTHORIZED==='1'&&process.env.DATABASE_URL?'postgres':null;trace.calls.push('database:'+mode);if(!mode)throw Error('fixture database not configured');db.kind=mode;return db;},
 async embedded(){trace.calls.push('embedded');db.kind='pglite';return db;},
 postgres(url){trace.calls.push('postgres');trace.urls.push(url);db.kind='postgres';return db;}};
const source='const {database,embedded,postgres,provisionOwner,acceptableOwnerPassword,SCHEMA}=globalThis.__setupFixture;\n'+withoutImports(readFileSync(root+'/scripts/owner-password-setup.ts','utf8'));
try{await import(moduleUrl(compile(source)));}
catch(error){trace.uncaught=String(error.message);console.error('UNCAUGHT_FIXTURE: '+error.message);process.exitCode=1;}
console.log('TRACE_FIXTURE:'+JSON.stringify(trace));
"""


@unittest.skipUnless(shutil.which("node"), "Node is required for mocked TypeScript helper checks")
class WorkerGuardsTests(unittest.TestCase):
    def run_worker(self, *, flags=None, payload=None, raw=None, **fixture):
        fixture["flags"] = ["--owner-setup-authorized"] if flags is None else flags
        fixture.setdefault("environment", {"STUDIO_LOCAL_DB": "1", "STUDIO_DATABASE_AUTHORIZED": "0"})
        body = raw if raw is not None else json.dumps(payload or {"password": PASSWORD, "database_url": ""})
        node = shutil.which("node")
        result = subprocess.run(
            [node, "--no-warnings", "--input-type=module", "-e", NODE_HARNESS, str(ROOT), json.dumps(fixture)],
            input=body, text=True, capture_output=True, timeout=15, cwd=ROOT,
            env={"PATH": str(Path(node).parent)},
        )
        lines = [line for line in result.stdout.splitlines() if line.startswith("TRACE_FIXTURE:")]
        self.assertEqual(len(lines), 1, result.stderr)
        return result, json.loads(lines[0].removeprefix("TRACE_FIXTURE:"))

    def remote(self, url=REMOTE, **fixture):
        return self.run_worker(flags=["--owner-setup-authorized", "--remote", "--migrate-authorized"],
                               payload={"password": PASSWORD, "database_url": url}, **fixture)

    def test_worker_requires_owner_authorization_before_database_access(self):
        result, trace = self.run_worker(flags=[])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace["calls"], [])

    def test_worker_requires_migration_authorization_before_remote_access(self):
        result, trace = self.run_worker(flags=["--owner-setup-authorized", "--remote"],
                                        payload={"password": PASSWORD, "database_url": REMOTE})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace["calls"], [])

    def test_worker_does_not_use_password_argument(self):
        result, trace = self.run_worker(flags=["--owner-setup-authorized", "--password", PASSWORD], raw="{}")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(sql.startswith("INSERT") for sql in trace["sql"]))

    def test_local_setup_uses_guarded_owner_creation(self):
        result, trace = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(trace["hashCalls"], 1)
        self.assertEqual(sum(sql.startswith("INSERT") for sql in trace["sql"]), 2)
        self.assertIn("SELECT id FROM studio_owner_login_guard WHERE id=1 FOR UPDATE", trace["sql"])
        self.assertEqual(trace["calls"][-1], "close")
        self.assertNotIn(PASSWORD, result.stdout + result.stderr)

    def test_existing_owner_is_never_overwritten(self):
        result, trace = self.run_worker(existingOwner=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(sql.startswith("INSERT") for sql in trace["sql"]))
        self.assertEqual(trace["calls"][-1], "close")
        self.assertNotIn(PASSWORD, result.stdout + result.stderr)

    def test_remote_schema_precedes_creation_and_tls_is_upgraded(self):
        result, trace = self.remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("sslmode=verify-full", trace["urls"][0])
        self.assertEqual(trace["sql"][0], "INERT_SCHEMA_FIXTURE")
        self.assertEqual(trace["calls"].count("transaction"), 2)
        self.assertEqual(trace["calls"][-1], "close")

    def test_standard_neon_channel_binding_and_verify_full_remain_supported(self):
        for mode in ("require", "verify-full"):
            with self.subTest(mode=mode):
                result, trace = self.remote(
                    "postgresql://dummy:dummy@ep-fixture-pooler.ap-southeast-1.aws.neon.tech/neondb"
                    + "?sslmode=" + mode + "&channel_binding=require"
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("sslmode=verify-full", trace["urls"][0])
                self.assertIn("channel_binding=require", trace["urls"][0])
                self.assertIn(":5432/neondb", trace["urls"][0])

    def test_remote_invalid_password_is_rejected_before_schema_or_database_access(self):
        for password in ("short", "12345678901", PASSWORD + "\n", None, {}, "x" * 129):
            with self.subTest(password_type=type(password).__name__):
                result, trace = self.run_worker(
                    flags=["--owner-setup-authorized", "--remote", "--migrate-authorized"],
                    payload={"password": password, "database_url": REMOTE},
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(trace["calls"], [])

    def test_target_scheme_host_override_and_weak_tls_are_rejected(self):
        for url in (
            "http://ep-fixture.neon.tech/fixture?sslmode=require",
            "postgres://dummy:dummy@evil.test/fixture?sslmode=require",
            "postgres://dummy:dummy@ep-fixture.neon.tech.evil.test/fixture?sslmode=require",
            "postgres://dummy:dummy@ep-fixture.neon.tech/fixture?sslmode=disable",
            "postgres://dummy:dummy@ep-fixture.neon.tech/fixture?sslmode=no-verify",
            "postgres://dummy:dummy@ep-fixture.neon.tech/fixture",
            REMOTE + "&host=evil.test",
            REMOTE + "&sslmode=disable",
            REMOTE + "&channel_binding=disable",
            REMOTE + "&options=inert-unused-fixture",
            "postgres://dummy:dummy@ep-fixture.neon.tech:6432/fixture?sslmode=require",
            "postgres://ep-fixture.neon.tech/fixture?sslmode=require",
            "postgres://dummy@ep-fixture.neon.tech/fixture?sslmode=require",
            "postgres://dummy:dummy@ep-fixture.neon.tech/?sslmode=require",
        ):
            with self.subTest(url=url):
                result, trace = self.remote(url)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("postgres", trace["calls"])

    def test_encoded_unix_socket_hostname_is_rejected_before_postgres(self):
        result, trace = self.remote("postgres://dummy:dummy@%2Ftmp%2Ffixture.neon.tech/db?sslmode=verify-full")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("postgres", trace["calls"])

    def test_local_certificate_file_parameters_are_rejected_before_postgres(self):
        for name in ("sslkey", "sslcert", "sslrootcert"):
            with self.subTest(parameter=name):
                result, trace = self.remote(REMOTE + "&" + name + "=/inert-unused-fixture")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("postgres", trace["calls"])

    def test_local_mode_cannot_select_inherited_remote_database(self):
        result, trace = self.run_worker(environment={"DATABASE_URL": REMOTE, "STUDIO_DATABASE_AUTHORIZED": "1"})
        self.assertNotIn("database:postgres", trace["calls"])
        self.assertNotIn("postgres", trace["calls"])

    def test_local_mode_rejects_hosted_markers_before_database_access(self):
        for name in ("VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"):
            with self.subTest(marker=name):
                result, trace = self.run_worker(environment={
                    "STUDIO_LOCAL_DB": "1", "STUDIO_DATABASE_AUTHORIZED": "0", name: "inert-fixture",
                })
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(trace["calls"], [])

    def test_local_mode_rejects_connection_string_in_payload(self):
        result, trace = self.run_worker(payload={"password": PASSWORD, "database_url": REMOTE})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace["calls"], [])

    def test_malformed_and_oversized_input_fail_without_database_access(self):
        for raw in ("{", "null", "[]", "x" * 2049, json.dumps({"password": PASSWORD, "database_url": "", "extra": True})):
            with self.subTest(raw_length=len(raw)):
                result, trace = self.run_worker(raw=raw)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(trace["calls"], [])
                self.assertIsNone(trace["uncaught"])

    def test_driver_errors_are_generic_and_close_is_attempted(self):
        marker = "inert-private-driver-error-fixture"
        result, trace = self.run_worker(transactionError=marker)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(trace["uncaught"])
        self.assertNotIn(marker, result.stderr)
        self.assertEqual(trace["calls"][-1], "close")

    def test_cleanup_errors_do_not_leak_driver_details_or_claim_success(self):
        marker = "inert-private-close-error-fixture"
        result, trace = self.run_worker(closeError=marker)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(trace["uncaught"])
        self.assertNotIn(marker, result.stderr)
        self.assertNotIn("owner password prepared", result.stdout)


if __name__ == "__main__":
    unittest.main()
