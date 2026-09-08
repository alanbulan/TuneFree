use super::TempDir;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};

pub(crate) const HOSTS: [&str; 6] = [
    "music.163.com",
    "interface3.music.163.com",
    "u.y.qq.com",
    "search.kuwo.cn",
    "artistpicserver.kuwo.cn",
    "mobi.kuwo.cn",
];

pub(crate) struct HttpsServer {
    process: Child,
    directory: TempDir,
    pub(crate) client: reqwest::Client,
}

impl HttpsServer {
    pub(crate) fn start(replies: Value) -> Self {
        let directory = TempDir::new();
        std::fs::write(
            directory.0.join("replies.json"),
            serde_json::to_vec(&replies).unwrap(),
        )
        .unwrap();
        let mut process = Command::new("node")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/src/__tests__/https_fixture.mjs"
            ))
            .arg(&directory.0)
            .stdout(Stdio::piped())
            .spawn()
            .expect("本机 HTTPS 测试需要项目已有的 Node.js 环境");
        let mut port = String::new();
        BufReader::new(process.stdout.take().unwrap())
            .read_line(&mut port)
            .unwrap();
        let address = format!("127.0.0.1:{}", port.trim()).parse().unwrap();
        let mut client = reqwest::Client::builder()
            .no_proxy()
            .add_root_certificate(
                reqwest::Certificate::from_pem(include_bytes!("https-cert.pem")).unwrap(),
            )
            .timeout(std::time::Duration::from_secs(3));
        for host in HOSTS {
            client = client.resolve(host, address);
        }
        Self {
            process,
            directory,
            client: client.build().unwrap(),
        }
    }

    pub(crate) fn calls(&self) -> Vec<Value> {
        std::fs::read_to_string(self.directory.0.join("calls.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

impl Drop for HttpsServer {
    fn drop(&mut self) {
        self.process.kill().unwrap();
        self.process.wait().unwrap();
    }
}
