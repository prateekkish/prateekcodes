---
layout: post
title: "What are the new Rails 8 framework defaults?"
author: prateek
categories: [ Rails, Rails 8, Configuration ]
tags: [ rails, upgrade, configuration, rails-8, framework-defaults ]
excerpt: "Rails 8 framework defaults include timezone preservation in to_time methods, strict HTTP freshness checking following RFC standards, and default regex timeout for DoS protection. Learn what each default does and how to safely enable them in your Rails application."
description: "A comprehensive guide to Rails 8's new framework defaults in new_framework_defaults_8_0.rb. Learn about to_time_preserves_timezone, strict_freshness, and Regexp.timeout configurations, when to enable them, and what supporting changes are needed for a safe Rails 8 upgrade."
keywords: "Rails 8, framework defaults, Rails upgrade, new_framework_defaults_8_0.rb, to_time_preserves_timezone, strict_freshness, Regexp.timeout, Rails configuration, Rails 8.0 upgrade"
---

When upgrading to Rails 8, running `rails app:update` generates a file called `config/initializers/new_framework_defaults_8_0.rb`. Rails 8's framework defaults are relatively minimal compared to previous versions, focusing on timezone handling, HTTP caching behavior, and security improvements through regex timeout settings.

## ActiveSupport.to_time_preserves_timezone = :zone

```ruby
# Preserves the timezone when converting to `Time` with `to_time`.
# `ActiveSupport.to_time_preserves_timezone = false` was the default behavior
# before Rails 8.0. With Rails 8.0, the default becomes `:zone` which
# preserves the timezone of the receiver when converting to `Time`.
Rails.application.config.active_support.to_time_preserves_timezone = :zone
```

### What this default does

This configuration changes how `to_time` methods handle timezone information. When set to `:zone`, the `to_time` method preserves the timezone of the receiver instead of converting to the system's local timezone.

**Before Rails 8:**
```ruby
# Assuming system timezone is EST
time_in_utc = Time.parse("2024-01-01 12:00:00 UTC")
time_in_utc.to_time
# => 2024-01-01 07:00:00 -0500 (converted to system timezone)
```

**Rails 8 with `:zone`:**
```ruby
time_in_utc = Time.parse("2024-01-01 12:00:00 UTC")
time_in_utc.to_time
# => 2024-01-01 12:00:00 UTC (preserves original timezone)
```

### When to uncomment

**Safe to uncomment if:**
- Your application expects `to_time` to preserve the original timezone
- You don't have code that relies on automatic conversion to system timezone
- You want more predictable timezone behavior across different environments

**Not safe to uncomment if:**
- Your application relies on `to_time` converting to the local system timezone
- You have legacy code that expects the old behavior
- You process timestamps from external sources that need local timezone conversion

### Supporting changes needed

Due to [a known issue](https://github.com/rails/rails/issues/54015){:target="_blank" rel="noopener noreferrer"}, this configuration must be set in `config/application.rb` instead of the framework defaults initializer:

```ruby
# config/application.rb
module YourApp
  class Application < Rails::Application
    config.load_defaults 8.0
    
    # This needs to be here, not in new_framework_defaults_8_0.rb
    config.active_support.to_time_preserves_timezone = :zone
  end
end
```

## ActionDispatch.strict_freshness = true

```ruby
# Changes the behavior of `ActionController::ConditionalGet#fresh_when` and
# `#stale?`, so that they honor the `If-None-Match` header before the
# `If-Modified-Since` header, as specified by RFC 7232 section 6.
Rails.application.config.action_dispatch.strict_freshness = true
```

### What this default does

This setting aligns Rails with the HTTP specification (RFC 7232) for handling conditional GET requests. When enabled, ETag headers take precedence over Last-Modified headers when determining if a cached response is fresh.

**Before Rails 8:**
```ruby
# Both ETag AND Last-Modified must match for 304 response
fresh_when(etag: @post, last_modified: @post.updated_at)
# Client needs both headers to match for cache hit
```

**Rails 8 with strict_freshness:**
```ruby
# Only ETag needs to match for 304 response (per HTTP spec)
fresh_when(etag: @post, last_modified: @post.updated_at)
# If ETag matches, returns 304 regardless of Last-Modified
```

### When to uncomment

**Safe to uncomment if:**
- You want RFC-compliant HTTP caching behavior
- Your caching strategy primarily relies on ETags
- You're building a new API or have control over client implementations

**Not safe to uncomment if:**
- Your application or clients depend on both ETag and Last-Modified matching
- You have custom caching logic that expects the historical Rails behavior
- Your CDN or proxy servers are configured for the old behavior

### Supporting changes needed

Review your controller caching logic:

```ruby
# Check uses of fresh_when and stale?
class PostsController < ApplicationController
  def show
    @post = Post.find(params[:id])
    
    # This behavior changes with strict_freshness
    fresh_when(@post)
  end
end
```

## Regexp.timeout = 1

```ruby
# Sets the default maximum amount of time a `Regexp` match can take, before a
# `Regexp::TimeoutError` is raised. Defaults to `nil`, which means there is no
# timeout. Can be configured with `Regexp.timeout=`.
# 
# If set, this value applies to all Regex matching operations in the Ruby
# process. This is a mitigation for potential Denial of Service attacks that
# exploit certain Regex patterns.
# 
# See https://stdgems.org/regexp_parser/Regexp.html#timeout-class_method for
# more information.
Regexp.timeout = 1
```

### What this default does

This sets a global 1-second timeout for all regular expression operations in your application, protecting against ReDoS (Regular Expression Denial of Service) attacks.

```ruby
# Without timeout (potential DoS vulnerability)
"a" * 50 + "b" =~ /a+a+b/  # Can take exponential time

# With 1-second timeout
Regexp.timeout = 1
"a" * 50 + "b" =~ /a+a+b/  # Raises Regexp::TimeoutError after 1 second
```

### When to uncomment

**Safe to uncomment if:**
- You're using Ruby 3.2 or later (required for this feature)
- Your regexes are well-optimized and don't require long execution times
- You want protection against ReDoS attacks

**Not safe to uncomment if:**
- You have complex regexes that legitimately take more than 1 second
- You're processing large text files with regex operations
- You're using an older Ruby version or alternative Ruby implementation

### Supporting changes needed

Identify and optimize slow regexes:

```ruby
# Wrap potentially slow regex operations
begin
  result = large_text.match(/complex_pattern/)
rescue Regexp::TimeoutError
  # Handle timeout appropriately
  Rails.logger.warn "Regex timeout occurred"
  # Consider simplifying the regex or increasing timeout
end

# Or set custom timeout for specific operations
Regexp.timeout = 5 do
  # Complex regex operation that needs more time
end
```

## Conclusion

Rails 8's framework defaults are focused and minimal, addressing specific concerns around timezone handling, HTTP specification compliance, and security. Unlike previous Rails versions, these changes are relatively safe to adopt, though the timezone configuration requires special attention due to the loading order issue.

## References

- [PR #53490 - Default Regexp.timeout to 1s](https://github.com/rails/rails/pull/53490){:target="_blank" rel="noopener noreferrer"}
- [PR #52274 - Prefer ETag over Last-Modified for fresh_when and stale?](https://github.com/rails/rails/pull/52274){:target="_blank" rel="noopener noreferrer"}
- [Issue #54015 - Setting active_support.to_time_preserves_timezone in new_frameworks_default_8_0.rb does not work](https://github.com/rails/rails/issues/54015){:target="_blank" rel="noopener noreferrer"}