---
layout: post
title: "Rails 8.2 makes enqueue_after_transaction_commit the default"
author: prateek
categories: [ Rails, Rails 8.2, Active Job ]
tags: [ rails-8-2, active-job, transactions, background-jobs ]
excerpt: "Rails 8.2 changes the default behavior for job enqueueing. Jobs are now automatically deferred until after the database transaction commits."
description: "Rails 8.2 enables enqueue_after_transaction_commit by default, ensuring jobs wait for transaction commits before being dispatched to the queue."
keywords: "Rails 8.2 enqueue_after_transaction_commit default, Active Job transaction commit, Rails job queue transaction, Rails 8.2 new defaults"
---

[Rails 7.2](/rails-72-enqueue-after-transaction-commit){:target="_blank" rel="noopener noreferrer" aria-label="Blog post about Rails 7.2 enqueue_after_transaction_commit (opens in new tab)"} introduced `enqueue_after_transaction_commit` to prevent race conditions when jobs are enqueued inside database transactions. However, it required explicit opt-in. Rails 8.2 flips the default. Jobs are now automatically deferred until after the transaction commits.

## The Problem with Opt-In

With the opt-in approach in Rails 7.2, teams had to remember to enable the feature:

```ruby
config.active_job.enqueue_after_transaction_commit = :default
```

Or configure it per-job:

```ruby
class WelcomeEmailJob < ApplicationJob
  self.enqueue_after_transaction_commit = :always
end
```

This created inconsistency. Some jobs would be transaction-aware, others would not. The safer behavior required explicit action.

## Rails 8.2 Changes the Default

[PR #55788](https://github.com/rails/rails/pull/55788){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR making enqueue_after_transaction_commit the default (opens in new tab)"} changes this. When you upgrade to Rails 8.2 and run `load_defaults "8.2"`, jobs are automatically deferred until after the transaction commits.

```ruby
def create
  User.transaction do
    user = User.create!(params)
    WelcomeEmailJob.perform_later(user)  # Deferred until commit
  end
end
```

No configuration needed. The job waits for the transaction to complete before being dispatched to the queue.

## Opting Out

If you need immediate enqueueing for backward compatibility or specific use cases, you have two options.

**Global configuration:**

```ruby
config.active_job.enqueue_after_transaction_commit = false
```

**Per-job configuration:**

```ruby
class TimeStampedJob < ApplicationJob
  self.enqueue_after_transaction_commit = false
end
```

## Why the Global Config Was Restored

The global configuration option has an interesting history. It was deprecated and removed in Rails 8.1. The team initially wanted each job to declare its own preference. However, changing the default behavior without a global opt-out would break existing applications.

The PR restored the global configuration specifically to allow apps upgrading to Rails 8.2 to maintain their existing behavior without modifying every job class.

## When This Matters

The new default primarily affects jobs enqueued to external queues like Redis (Sidekiq, Resque). If you use a database-backed queue like Solid Queue or GoodJob with the same database, your jobs are already part of the same transaction.

Jobs that do not depend on transaction data can still be configured for immediate enqueueing if needed.

## Conclusion

Rails 8.2 makes the safer behavior the default. Jobs enqueued inside transactions automatically wait for the commit, eliminating a common source of race conditions without requiring explicit configuration.

## References

- [Pull Request #55788](https://github.com/rails/rails/pull/55788){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR making enqueue_after_transaction_commit the default (opens in new tab)"} making this the default
- [Pull Request #51426](https://github.com/rails/rails/pull/51426){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR introducing enqueue_after_transaction_commit (opens in new tab)"} introducing the feature in Rails 7.2
- [Rails 7.2 enqueue_after_transaction_commit](/rails-72-enqueue-after-transaction-commit){:aria-label="Blog post about Rails 7.2 enqueue_after_transaction_commit"} - detailed explanation of the feature
