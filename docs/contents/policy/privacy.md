---
title: Privacy Policy for fusou
description: >-
  This Privacy Policy describes how the application "fusou" collects, uses, and handles user information.
contributors: ["tsukasa-u", "antigravity-ai"]
date: 2026-11-15
slug: policy/privacy
tags: [policy, privacy]
---

# Privacy Policy for fusou

**1. Overview**
This Privacy Policy describes how the application "fusou" (hereinafter referred to as "the App") collects, uses, and handles user information.

**2. Information Collection**
The App collects and handles information only according to your configuration:

- **Account & Authentication Information (Optional):** When you sign in to FUSOU (via Supabase Auth, such as email/OAuth sign-in or dashboard API keys), the App handles session tokens and account identifiers needed for authentication. Anonymous data submission does not require signing in when anonymous sync is enabled.
- **Game & Fleet Data:** When enabled in `configs.toml`, the App processes game traffic locally and may store local Avro OCF / JSONL files or upload anonymized/configured battle data, fleet snapshots, and static assets to FUSOU's cloud infrastructure (Cloudflare R2 / D1 and Supabase). Legacy Google Drive sync (`gdrive` feature) is deprecated and disabled in default builds.

**3. Purpose of Use**
The information collected is used solely for the following purposes:

- To provide the App and Web features (such as local/cloud game data collection, fleet snapshot sharing, and dataset publication).
- To verify the user's identity when signed in.
- To respond to user inquiries.

**4. Third-Party Sharing**
The App will not provide personal information to third parties without the user's consent, except where required by law. Furthermore, the App will not use the collected data for advertising purposes or sell it to third parties.

**5. Disclaimer**
The developer assumes no responsibility for any damages arising from the use of this App.

**6. Changes to this Privacy Policy**
The contents of this policy may be changed as necessary. If significant changes are made, users will be notified within the App or through other appropriate means.

**7. Contact Information**
If you have any questions regarding this Privacy Policy, please contact us at:

- Contact: ogu.hide.u [at] gmail [dot] com

**Effective Date**: 2025-12-4
