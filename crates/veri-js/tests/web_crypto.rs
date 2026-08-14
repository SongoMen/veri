//! `crypto.subtle.encrypt` returned its input unchanged.

mod common;
use common::probe;

#[test]
fn aes_gcm_matches_the_nist_vectors() {
    let hex = "function(b){return Array.from(new Uint8Array(b)).map(function(x){\
                return x.toString(16).padStart(2,'0');}).join('');}";
    let bytes = "function(h){var o=new Uint8Array(h.length/2);\
                 for(var i=0;i<o.length;i++)o[i]=parseInt(h.substr(i*2,2),16);return o;}";

    // AES-128, empty plaintext and AAD: the tag alone.
    let tag = probe(&format!(
        "(function(){{var hex={hex},bytes={bytes};\
         return hex(__aesGcmEncrypt(bytes('{k}'),bytes('{iv}'),new Uint8Array(0),new Uint8Array(0)));}})()",
        k = "00000000000000000000000000000000",
        iv = "000000000000000000000000",
    ));
    assert_eq!(tag, "58e2fccefa7e3061367f1d57a4e7455a");

    // AES-128, one zero block.
    let block = probe(&format!(
        "(function(){{var hex={hex},bytes={bytes};\
         return hex(__aesGcmEncrypt(bytes('{k}'),bytes('{iv}'),new Uint8Array(16),new Uint8Array(0)));}})()",
        k = "00000000000000000000000000000000",
        iv = "000000000000000000000000",
    ));
    assert_eq!(block, "0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf");

    // AES-256, empty plaintext: a 32-byte key must take the longer key schedule.
    let k256 = probe(&format!(
        "(function(){{var hex={hex},bytes={bytes};\
         return hex(__aesGcmEncrypt(bytes('{k}'),bytes('{iv}'),new Uint8Array(0),new Uint8Array(0)));}})()",
        k = "0000000000000000000000000000000000000000000000000000000000000000",
        iv = "000000000000000000000000",
    ));
    assert_eq!(k256, "530f8afbc74536b9a963b4f1c4cb738b");
}

#[test]
fn aes_gcm_authenticates_the_additional_data() {
    let out = probe(
        "(function(){\
         var bytes=function(h){var o=new Uint8Array(h.length/2);\
           for(var i=0;i<o.length;i++)o[i]=parseInt(h.substr(i*2,2),16);return o;};\
         var hex=function(b){return Array.from(new Uint8Array(b)).map(function(x){\
           return x.toString(16).padStart(2,'0');}).join('');};\
         var k=bytes('feffe9928665731c6d6a8f9467308308');\
         var iv=bytes('cafebabefacedbaddecaf888');\
         var pt=bytes('d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72\
1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39');\
         var aad=bytes('feedfacedeadbeeffeedfacedeadbeefabaddad2');\
         return hex(__aesGcmEncrypt(k,iv,pt,aad));})()",
    );
    assert_eq!(
        out,
        "42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c\
         7d8f6a5aac84aa051ba30b396a0aac973d58e0915bc94fbc3221a5db94fae95ae7121a47"
            .replace(['\n', ' '], "")
    );
}

#[test]
fn a_tampered_ciphertext_is_rejected() {
    let out = probe(
        "(function(){var k=new Uint8Array(16),iv=new Uint8Array(12);\
         var ct=__aesGcmEncrypt(k,iv,new Uint8Array([1,2,3,4]),new Uint8Array(0));\
         var ok=__aesGcmDecrypt(k,iv,ct,new Uint8Array(0));\
         var bad=ct.slice(); bad[0]^=1;\
         return (ok?Array.from(ok).join(','):'null')+'|'+String(__aesGcmDecrypt(k,iv,bad,new Uint8Array(0)));})()",
    );
    assert_eq!(out, "1,2,3,4|null", "roundtrip must work and tampering must be refused");
}

#[test]
fn subtle_encrypt_produces_real_ciphertext() {
    let out = probe(
        "(function(){\
         var r='';\
         return crypto.subtle.importKey('raw',new Uint8Array(16),{name:'AES-GCM'},false,['encrypt'])\
           .then(function(k){return crypto.subtle.encrypt(\
              {name:'AES-GCM',iv:new Uint8Array(12)},k,new Uint8Array([1,2,3,4]));})\
           .then(function(ct){var u=new Uint8Array(ct);\
              return u.length+'|'+Array.from(u.slice(0,4)).join(',');});})()",
    );
    // A promise stringifies as [object Promise]; the value is checked below.
    assert!(out.starts_with("[object"), "probe returns synchronously, got {out:?}");

    let sync = probe(
        "(function(){var ct=__aesGcmEncrypt(new Uint8Array(16),new Uint8Array(12),\
         new Uint8Array([1,2,3,4]),new Uint8Array(0));\
         return ct.length+'|'+(Array.from(ct.slice(0,4)).join(',')==='1,2,3,4');})()",
    );
    assert_eq!(sync, "20|false", "4 bytes in, 4 + a 16-byte tag out, and not the plaintext");
}
