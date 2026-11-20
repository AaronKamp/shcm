//! Backup file encryption. Layout: header (magic, Argon2id cost, salt, nonce)
//! followed by XChaCha20-Poly1305 ciphertext. The header is the AEAD's
//! associated data, so any edit to it or the ciphertext fails decryption.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"SHCMBAK\x01";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = MAGIC.len() + 12 + SALT_LEN + NONCE_LEN;
/// Argon2id cost: 64 MiB, 3 passes. About half a second, slow enough to make guessing expensive.
const M_COST_KIB: u32 = 64 * 1024;
const T_COST: u32 = 3;
const P_COST: u32 = 1;

fn derive_key(passphrase: &str, salt: &[u8], m: u32, t: u32, p: u32) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(m, t, p, Some(32)).map_err(|_| "Backup uses unsupported settings".to_owned())?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| "Couldn't derive the backup key".to_owned())?;
    Ok(key)
}

pub fn encrypt(passphrase: &str, plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut salt).map_err(|e| e.to_string())?;
    getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(HEADER_LEN + plain.len() + 16);
    out.extend_from_slice(MAGIC);
    for v in [M_COST_KIB, T_COST, P_COST] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    let key = derive_key(passphrase, &salt, M_COST_KIB, T_COST, P_COST)?;
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| "bad key length".to_owned())?;
    let sealed = cipher
        .encrypt(&XNonce::from(nonce), Payload { msg: plain, aad: &out })
        .map_err(|_| "Couldn't encrypt the backup".to_owned())?;
    out.extend_from_slice(&sealed);
    Ok(out)
}

pub fn decrypt(passphrase: &str, file: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if file.len() < HEADER_LEN + 16 || &file[..MAGIC.len()] != MAGIC {
        return Err("That isn't a Smart Home Command backup".into());
    }
    let (header, sealed) = file.split_at(HEADER_LEN);
    let num = |i: usize| u32::from_le_bytes([header[8 + i * 4], header[9 + i * 4], header[10 + i * 4], header[11 + i * 4]]);
    let (m, t, p) = (num(0), num(1), num(2));
    // A crafted header must not be able to demand gigabytes of RAM or minutes of CPU.
    if !(8 * 1024..=1024 * 1024).contains(&m) || !(1..=10).contains(&t) || !(1..=8).contains(&p) {
        return Err("Backup uses unsupported settings".into());
    }
    let salt = &header[20..20 + SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&header[20 + SALT_LEN..]);
    let key = derive_key(passphrase, salt, m, t, p)?;
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| "bad key length".to_owned())?;
    cipher
        .decrypt(&XNonce::from(nonce), Payload { msg: sealed, aad: header })
        .map(Zeroizing::new)
        .map_err(|_| "Wrong passphrase, or the file is damaged".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_wrong_passphrase_or_tampering() {
        let sealed = encrypt("correct horse", b"{\"hello\":1}").unwrap();
        assert_eq!(decrypt("correct horse", &sealed).unwrap().as_slice(), b"{\"hello\":1}");
        assert!(decrypt("wrong horse!", &sealed).is_err());
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(decrypt("correct horse", &tampered).is_err());
        let mut header = sealed;
        header[10] ^= 1; // cost field: authenticated, so decryption must fail
        assert!(decrypt("correct horse", &header).is_err());
    }

    #[test]
    fn rejects_foreign_files_and_absurd_costs() {
        assert!(decrypt("x", b"not a backup at all, definitely not").is_err());
        let mut sealed = encrypt("passphrase", b"x").unwrap();
        sealed[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(decrypt("passphrase", &sealed).unwrap_err(), "Backup uses unsupported settings");
    }
}
