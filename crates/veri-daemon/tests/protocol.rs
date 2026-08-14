use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

struct Daemon {
    proc: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Daemon {
    fn start() -> Self {
        let mut proc = Command::new(env!("CARGO_BIN_EXE_veri-daemon"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the daemon binary must run");
        let stdin = proc.stdin.take().expect("stdin");
        let mut stdout = BufReader::new(proc.stdout.take().expect("stdout"));
        let mut ready = String::new();
        stdout.read_line(&mut ready).expect("the daemon must announce itself");
        assert!(ready.contains("\"ready\":true"), "unexpected greeting: {ready}");
        Self { proc, stdin, stdout }
    }

    fn ask(&mut self, line: &str) -> serde_json::Value {
        writeln!(self.stdin, "{line}").expect("write");
        self.stdin.flush().expect("flush");
        let mut out = String::new();
        self.stdout.read_line(&mut out).expect("the daemon must answer every line it accepts");
        serde_json::from_str(&out).unwrap_or_else(|e| panic!("unparseable reply {out:?}: {e}"))
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.proc.kill();
        let _ = self.proc.wait();
    }
}

#[test]
fn a_request_that_fails_to_parse_is_answered_under_its_own_id() {
    let mut d = Daemon::start();
    // Deserialises no further than the id: `method` is required.
    let reply = d.ask(r#"{"id":7}"#);
    assert_eq!(reply["id"], 7, "answering under id 0 leaves the caller waiting forever");
    assert_eq!(reply["ok"], false);
    assert!(reply["error"].as_str().unwrap_or_default().contains("malformed request"), "{reply}");
}

#[test]
fn a_line_that_is_not_json_is_answered_under_id_zero() {
    let mut d = Daemon::start();
    let reply = d.ask("this is not json");
    assert_eq!(reply["id"], 0);
    assert_eq!(reply["ok"], false);
}

#[test]
fn a_valid_request_still_answers_under_its_own_id() {
    let mut d = Daemon::start();
    let reply = d.ask(r#"{"id":42,"method":"info"}"#);
    assert_eq!(reply["id"], 42);
    assert_eq!(reply["ok"], true, "{reply}");
}
