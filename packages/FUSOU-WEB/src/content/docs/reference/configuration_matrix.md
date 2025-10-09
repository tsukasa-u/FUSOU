---
title: Configuration Matrix
contributors: ["tsukasa-u"]
description: Matrix of environment configurations used across deployments
date: 2025-10-10
slug: reference/configuration_matrix
tags: [reference, config]
---

# Configuration Matrix

| Environment | API URL                           | Assets CDN                        | Feature Flags  | Notes                    |
| ----------- | --------------------------------- | --------------------------------- | -------------- | ------------------------ |
| local       | `http://localhost:4000`           | `http://localhost:8080`           | `preview`      | Developer machines       |
| staging     | `https://api-staging.example.com` | `https://cdn-staging.example.com` | `preview,beta` | Auto deploy from develop |
| production  | `https://api.example.com`         | `https://cdn.example.com`         | `stable`       | Manual approval required |

## Secrets inventory

- `SERVICE_ACCOUNT_JSON`
- `SENTRY_DSN`
- `GITHUB_TOKEN`

> Store secrets in the platform vault; never commit them to the repository.
