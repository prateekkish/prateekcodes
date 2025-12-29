---
layout: post
title: "Rails 8.2 introduces Rails.app.creds for unified credential management"
author: prateek
categories: [ Rails, Rails 8, Configuration ]
tags: [ rails-8, credentials, configuration, environment-variables, secrets-management ]
excerpt: "Rails 8.2 adds Rails.app.creds to provide a unified API that checks environment variables first, then falls back to encrypted credentials."
description: "Learn how Rails 8.2's new Rails.app.creds provides unified credential lookup across ENV and encrypted credentials, eliminating code changes when migrating between storage methods."
keywords: "Rails 8.2 credentials, Rails.app.creds, combined credentials Rails, environment variables Rails, Rails secrets management, Rails configuration unified API"
---

Applications often store secrets in both environment variables and encrypted credential files. Migrating between these storage methods or using both simultaneously has traditionally required code changes. Rails 8.2 solves this with `Rails.app.creds`, a unified API that checks ENV first, then falls back to encrypted credentials.

## Before

Managing credentials from multiple sources meant mixing different APIs:

```ruby
class StripeService
  def initialize
    # Check ENV first, fallback to credentials
    @api_key = ENV["STRIPE_API_KEY"] || Rails.application.credentials.dig(:stripe, :api_key)
    @webhook_secret = ENV.fetch("STRIPE_WEBHOOK_SECRET") {
      Rails.application.credentials.stripe&.webhook_secret
    }

    raise "Missing Stripe API key!" unless @api_key
  end
end

class DatabaseConfig
  def connection_url
    # Different syntax for each source
    ENV["DATABASE_URL"] || Rails.application.credentials.database_url
  end

  def redis_url
    ENV.fetch("REDIS_URL", Rails.application.credentials.dig(:redis, :url) || "redis://localhost:6379")
  end
end
```

This approach has several problems:
- Inconsistent APIs between `ENV.fetch()` and `credentials.dig()`
- Manual fallback logic scattered throughout the codebase
- Code changes required when moving secrets between storage methods
- Easy to forget nil checks on nested credentials

## Rails 8.2

The new `Rails.app.creds` provides a consistent interface:

```ruby
class StripeService
  def initialize
    @api_key = Rails.app.creds.require(:stripe_api_key)
    @webhook_secret = Rails.app.creds.require(:stripe_webhook_secret)
  end
end

class DatabaseConfig
  def connection_url
    Rails.app.creds.require(:database_url)
  end

  def redis_url
    Rails.app.creds.option(:redis_url, default: "redis://localhost:6379")
  end
end
```

The `require` method mandates a value exists and raises `KeyError` if missing from both ENV and encrypted credentials. The `option` method returns `nil` or a default value gracefully.

## Nested Keys

For nested credentials, pass multiple keys. Rails automatically converts them to the appropriate format for each source:

```ruby
# Checks ENV["AWS__ACCESS_KEY_ID"] first, then credentials.dig(:aws, :access_key_id)
Rails.app.creds.require(:aws, :access_key_id)

# Multi-level nesting
# ENV["REDIS__CACHE__TTL"] || credentials.dig(:redis, :cache, :ttl)
Rails.app.creds.option(:redis, :cache, :ttl, default: 3600)
```

The ENV lookup uses double underscores (`__`) as separators for nested keys:
- `:database_url` → `ENV["DATABASE_URL"]`
- `[:aws, :region]` → `ENV["AWS__REGION"]`
- `[:redis, :cache, :ttl]` → `ENV["REDIS__CACHE__TTL"]`

## Dynamic Defaults

The `option` method accepts callable defaults, evaluated only when needed:

```ruby
Rails.app.creds.option(:cache_ttl, default: -> { 1.hour })
Rails.app.creds.option(:max_connections, default: -> { calculate_pool_size })
```

## ENV-Only Access

Access environment variables directly using the same API via `Rails.app.envs`:

```ruby
# Only checks ENV, no encrypted credentials fallback
Rails.app.envs.require(:port)
Rails.app.envs.option(:log_level, default: "info")
```

## Custom Credential Sources

Under the hood, `Rails.app.creds` is powered by `ActiveSupport::CombinedConfiguration`, which checks multiple credential sources (called backends) in order. By default, it checks ENV first, then encrypted credentials. You can customize this chain to include external secret managers:

```ruby
# config/initializers/credentials.rb
Rails.app.creds = ActiveSupport::CombinedConfiguration.new(
  Rails.app.envs,                   # Check ENV first
  VaultConfiguration.new,           # Then HashiCorp Vault
  OnePasswordConfiguration.new,     # Then 1Password
  Rails.app.credentials             # Finally, encrypted credentials
)
```

Each credential source needs to implement `require` and `option` methods matching the API.

## Rails.app Alias

This feature comes alongside a new `Rails.app` alias for `Rails.application`:

```ruby
# Before
Rails.application.credentials.aws.access_key_id

# After
Rails.app.credentials.aws.access_key_id
```

The shorter alias makes chained method calls more pleasant to read and write.

## Conclusion

`Rails.app.creds` eliminates the friction of managing credentials across multiple sources. Secrets can move between ENV and encrypted files without touching application code.

## References

- [PR #56404](https://github.com/rails/rails/pull/56404){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR 56404 add Rails.app.creds (opens in new tab)"} - Add Rails.app.creds for combined credentials lookup
- [PR #56403](https://github.com/rails/rails/pull/56403){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR 56403 add Rails.app alias (opens in new tab)"} - Add Rails.app alias for Rails.application
