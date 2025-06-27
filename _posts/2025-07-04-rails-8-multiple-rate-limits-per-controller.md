---
layout: post
title: "Rails 8 adds ability to use multiple rate limits per controller"
author: prateek
categories: [ Rails, Rails 8, Security ]
tags: [ rails, rate-limiting, security, rails-8, action-controller ]
excerpt: "Rails 8 now allows defining multiple rate limits within a single controller using named configurations. Learn how to implement granular rate limiting strategies for different actions and time periods."
description: "Rails 8 enhances rate limiting by allowing multiple named rate limits per controller. Implement different rate limiting strategies for short-term bursts and long-term quotas within the same controller using the new name parameter."
keywords: "Rails 8, rate limiting, multiple rate limits, ActionController, rate_limit method, Rails security, API throttling, request limiting"
---

Rails 7.2 introduced built-in rate limiting to Action Controller. However, you could only set one rate limit per controller, which wasn't flexible enough for real-world applications. Rails 8 solves this by allowing multiple rate limits using the `name:` parameter.

## Before Rails 8

In Rails 7.2, you were limited to a single rate limit configuration:

```ruby
class PostsController < ApplicationController
  # Only one rate limit for the entire controller
  rate_limit to: 10, within: 1.minute, only: :create

  def index
    # No rate limiting
  end

  def create
    # Limited to 10 requests per minute
  end

  def destroy
    # No rate limiting (but what if we wanted stricter limits here?)
  end
end
```

This `rate_limit` call means: "Allow a maximum of 10 requests within 1 minute for the create action only."

## Rails 8: Multiple Rate Limits

Now you can define different rate limiting strategies:

```ruby
class PostsController < ApplicationController
  # Short-term: Prevent burst traffic
  rate_limit to: 5, within: 2.seconds, only: :create, name: "burst_control"

  # Long-term: Enforce hourly quotas
  rate_limit to: 100, within: 1.hour, only: :create, name: "hourly_limit"

  # Stricter limits for destructive actions
  rate_limit to: 10, within: 10.minutes, only: :destroy, name: "delete_limit"

  def index
    # No rate limiting applied
  end

  def create
    # Two rate limits applied:
    # 1. Maximum 5 requests every 2 seconds (burst control)
    # 2. Maximum 100 requests per hour (quota)
  end

  def destroy
    # One rate limit: Maximum 10 deletes every 10 minutes
  end
end
```

Let's break down what each `rate_limit` does:

1. **Burst Control**:

   ```ruby
   rate_limit to: 5, within: 2.seconds, only: :create, name: "burst_control"
   ```
   - Prevents users from hammering the create endpoint
   - If someone sends 6 requests in 2 seconds, the 6th request gets blocked

2. **Hourly Quota**:

   ```ruby
   rate_limit to: 100, within: 1.hour, only: :create, name: "hourly_limit"
   ```
   - Enforces a reasonable usage limit per hour
   - Even if requests are spread out, after 100 creates in an hour, further requests are blocked

3. **Delete Protection**:

   ```ruby
   rate_limit to: 10, within: 10.minutes, only: :destroy, name: "delete_limit"
   ```
   - Prevents mass deletion attacks
   - Allows only 10 delete operations every 10 minutes

## Practical Example: API Controller

Here's how you might protect different API endpoints with appropriate rate limits:

```ruby
class ApiController < ApplicationController
  # Prevent rapid-fire requests
  rate_limit to: 10, within: 1.minute, only: :search, name: "search_burst"

  # Daily search quota
  rate_limit to: 1000, within: 1.day, only: :search, name: "search_daily"

  # Stricter limits for expensive operations
  rate_limit to: 5, within: 1.hour, only: :generate_report, name: "report_limit"

  def search
    # Both rate limits apply here:
    # - Max 10 searches per minute
    # - Max 1000 searches per day
  end

  def generate_report
    # Limited to 5 reports per hour
  end

  def show
    # No rate limiting
  end
end
```

Each action can have multiple rate limits that work together. For the `search` action:
- Users can search up to 10 times per minute (prevents abuse)
- But also can't exceed 1000 searches per day (enforces fair usage)

## Why This Matters

Before Rails 8, if you wanted different rate limits for different actions, you had two options:
1. Create separate controllers (unnecessary complexity)
2. Use external gems like rack-attack (additional dependency)

Now, you can define exactly the rate limiting strategy you need, right in your controller.

## The Technical Fix

The problem was that all rate limits shared the same cache key. Rails 8 fixes this by including the `name` in the cache key:

```ruby
# Before (Rails 7.2): Same key for all rate limits
"rate_limit:posts_controller:127.0.0.1"

# After (Rails 8): Unique key for each named rate limit
"rate_limit:posts_controller:burst_control:127.0.0.1"
"rate_limit:posts_controller:hourly_limit:127.0.0.1"
"rate_limit:posts_controller:delete_limit:127.0.0.1"
```

## Conclusion

Rails 8's multiple rate limits feature gives you fine-grained control over request throttling without external gems. The `name:` parameter is all you need to implement sophisticated rate limiting strategies.

## References

- [PR #52960 - Add ability to use multiple rate limits per controller](https://github.com/rails/rails/pull/52960){:target="_blank" rel="noopener noreferrer"}
- [Issue #52957 - Multiple rate-limits share same cache key](https://github.com/rails/rails/issues/52957){:target="_blank" rel="noopener noreferrer"}
- [ActionController::RateLimiting Documentation](https://api.rubyonrails.org/classes/ActionController/RateLimiting/ClassMethods.html){:target="_blank" rel="noopener noreferrer"}