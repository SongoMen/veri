//! Every identity must actually send the User-Agent it claims.

mod common;

use veri::Client;

#[tokio::test]
async fn every_identity_sends_the_user_agent_it_claims() {
    let names = veri::ClientBuilder::available_identities();
    let server =
        common::start_reading(|_, req| common::response(200, req.header("user-agent"))).await;

    let mut wrong = Vec::new();
    for name in &names {
        let client = Client::builder().identity(name).build().expect("build");
        let res = client.get(&server.url).send().await.expect("request");
        let sent = res.text().to_string();
        let expected = veri::identity::by_name(name).expect("known identity").user_agent;
        if sent != expected {
            wrong.push(format!("{name}: claims {expected:?} but sent {sent:?}"));
        }
    }

    assert!(wrong.is_empty(), "identity/emulation UA mismatch:\n  {}", wrong.join("\n  "));
}
