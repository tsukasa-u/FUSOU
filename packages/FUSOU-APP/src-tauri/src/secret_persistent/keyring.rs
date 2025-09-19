use keyring::{Entry, Result};
use tokio::sync::{Mutex, MutexGuard, OnceCell};

static SERVICE_NAME: &str = "fusou-secret-persistent";
static EMAIL_TARGET: &str = "dmm-login-email";
static PASSWORD_TARGET: &str = "dmm-login-password";

static EMAIL_KEY: OnceCell<Mutex<Entry>> = OnceCell::const_new();
static PASSWORD_KEY: OnceCell<Mutex<Entry>> = OnceCell::const_new();

pub async fn get_email_entry() -> MutexGuard<'static, Entry> {
    EMAIL_KEY
        .get_or_init(|| async {
            let user_name = whoami::username();
            let entry = Entry::new_with_target(EMAIL_TARGET, SERVICE_NAME, &user_name).unwrap();
            Mutex::new(entry)
        })
        .await
        .lock()
        .await
}

pub async fn get_email() -> Result<String> {
    if configs::get_user_configs_for_app()
        .password_persistent
        .get_enable_email_address()
    {
        return Ok("".to_string());
    }

    let email_entry = get_email_entry().await;
    let email = email_entry.get_password()?;
    Ok(email)
}

pub async fn has_email() -> bool {
    let email_entry = get_email_entry().await;
    match email_entry.get_password() {
        Ok(s) if !s.is_empty() => true,
        _ => false,
    }
}

pub async fn set_email(email: &str) -> Result<()> {
    if configs::get_user_configs_for_app()
        .password_persistent
        .get_enable_email_address()
    {
        return Ok(());
    }

    let email_entry = get_email_entry().await;
    email_entry.set_password(email)?;
    Ok(())
}

pub async fn get_password_entry() -> MutexGuard<'static, Entry> {
    PASSWORD_KEY
        .get_or_init(|| async {
            let user_name = whoami::username();
            let entry = Entry::new_with_target(PASSWORD_TARGET, SERVICE_NAME, &user_name).unwrap();
            Mutex::new(entry)
        })
        .await
        .lock()
        .await
}

pub async fn get_password() -> Result<String> {
    if configs::get_user_configs_for_app()
        .password_persistent
        .get_enable_password()
    {
        return Ok("".to_string());
    }

    let password_entry = get_password_entry().await;
    let password = password_entry.get_password()?;
    Ok(password)
}

pub async fn has_password() -> bool {
    let password_entry = get_password_entry().await;
    match password_entry.get_password() {
        Ok(s) if !s.is_empty() => true,
        _ => false,
    }
}

pub async fn set_password(password: &str) -> Result<()> {
    if configs::get_user_configs_for_app()
        .password_persistent
        .get_enable_password()
    {
        return Ok(());
    }

    let password_entry = get_password_entry().await;
    password_entry.set_password(password)?;
    Ok(())
}

pub async fn delete_credentials() -> Result<()> {
    let email_entry = get_email_entry().await;
    let password_entry = get_password_entry().await;

    email_entry.delete_credential()?;
    password_entry.delete_credential()?;

    Ok(())
}

pub async fn set_credentials(email: &str, password: &str) -> Result<()> {
    set_email(email).await?;
    set_password(password).await?;

    Ok(())
}

pub async fn get_credentials() -> Result<(String, String)> {
    let email = get_email().await?;
    let password = get_password().await?;

    Ok((email, password))
}
