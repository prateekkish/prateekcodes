---
layout: post
title: "Rails 8.2 lets retry_on read the error when calculating wait time"
author: prateek
categories: [ Rails, Rails 8.2, Active Job ]
tags: [ rails-8-2, active-job, retry, background-jobs, error-handling ]
excerpt: "Rails 8.2 allows retry_on wait procs to receive the exception as a second argument, so jobs can use error-specific information like rate limit headers to decide how long to wait before retrying."
description: "Rails 8.2 adds error-aware wait procs to retry_on in Active Job. Pass a two-argument lambda to access the exception and use data like Retry-After headers in your backoff strategy."
keywords: "Rails 8.2 retry_on wait proc error, Active Job retry backoff, retry_on lambda error argument, Rails job retry rate limit, Rails 8.2 Active Job changes"
---

Active Job's `retry_on` accepts a `wait:` proc for custom backoff logic. Before Rails 8.2, that proc only received the execution count. When a remote API returns a `Retry-After` header, there was no way to use that value inside the proc. Rails 8.2 fixes this by passing the exception as a second argument.

## Before

The `wait:` proc only knew how many times the job had been attempted:

```ruby
class PaymentSyncJob < ApplicationJob
  retry_on Stripe::RateLimitError,
           attempts: 5,
           wait: ->(executions) { executions * 10 }

  def perform(order_id)
    Stripe::Charge.retrieve(order_id)
  end
end
```

If Stripe responded with a `Retry-After: 30` header, the job ignored it. The wait time was always based on the execution count, regardless of what the API actually asked for.

To work around this, teams typically stored retry delay information on the exception class itself and then retrieved it through other means, which added boilerplate and coupling.

## Rails 8.2

[PR #56601](https://github.com/rails/rails/pull/56601){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR 56601 allowing retry_on wait procs to accept the error (opens in new tab)"} allows the `wait:` proc to accept the exception as a second argument. Rails checks the proc's arity, so existing one-argument procs continue to work without any changes.

```ruby
class PaymentSyncJob < ApplicationJob
  retry_on Stripe::RateLimitError,
           attempts: 5,
           wait: ->(executions, error) { error.retry_after || executions * 10 }

  def perform(order_id)
    Stripe::Charge.retrieve(order_id)
  end
end
```

When the job retries, it calls the proc with both the execution count and the exception. If the error has a `retry_after` value, that gets used. Otherwise, it falls back to the execution-based formula.

This works for any error class that exposes delay information:

```ruby
class ExternalApiJob < ApplicationJob
  retry_on ApiRateLimitError,
           attempts: 10,
           wait: ->(executions, error) do
             # Use the header value if available, cap at 5 minutes
             [error.retry_after || executions ** 2, 300].min
           end

  def perform(resource_id)
    ExternalApi.fetch(resource_id)
  end
end
```

## Backward Compatibility

The change is fully backward compatible. A proc with one argument behaves exactly as before:

```ruby
# Still works, receives only executions
retry_on SomeError, wait: ->(executions) { executions * 5 }

# New behavior, receives both
retry_on SomeError, wait: ->(executions, error) { error.retry_after || executions * 5 }
```

Rails uses Ruby's `arity` to determine which form the proc uses and calls it accordingly.

## When to Use This

Use the two-argument form when:

- The API you call returns a `Retry-After` header or equivalent
- Your error class already captures the suggested wait time
- You want backoff logic that adapts to what the remote service requests rather than using a fixed formula

## Conclusion

Rails 8.2 makes retry logic more accurate for jobs that talk to rate-limited APIs. By exposing the exception to the `wait:` proc, jobs can respect what the remote service actually asks for instead of guessing.

## References

- [Pull Request #56601](https://github.com/rails/rails/pull/56601){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR 56601 retry_on error-aware wait proc (opens in new tab)"}
- [Active Job retry_on documentation](https://api.rubyonrails.org/classes/ActiveJob/Exceptions/ClassMethods.html#method-i-retry_on){:target="_blank" rel="noopener noreferrer" aria-label="Active Job retry_on API documentation (opens in new tab)"}
