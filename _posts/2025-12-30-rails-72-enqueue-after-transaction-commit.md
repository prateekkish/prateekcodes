---
layout: post
title: "Rails 7.2 adds enqueue_after_transaction_commit to prevent job race conditions"
author: prateek
categories: [ Rails, Rails 7.2, Active Job ]
tags: [ rails-7-2, active-job, transactions, background-jobs, sidekiq ]
excerpt: "Rails 7.2 makes Active Job transaction-aware, automatically deferring job enqueueing until after the transaction commits to prevent race conditions."
description: "Learn how Rails 7.2's enqueue_after_transaction_commit solves the common problem of jobs executing before database transactions complete, causing RecordNotFound and deserialization errors."
keywords: "Rails 7.2 enqueue_after_transaction_commit, Active Job transaction, Rails job race condition, after_commit job scheduling, Rails background job transaction"
---

Scheduling background jobs inside database transactions is a common anti-pattern which is a source of several production bugs in Rails applications. The job can execute before the transaction commits, leading to `RecordNotFound` or `ActiveJob::DeserializationError` because the data it needs does not exist yet. Or worse, the job could run assuming the txn would commit, but it rolls back at a later stage. We don't need that kind of optimism.

Rails 7.2 addresses this with `enqueue_after_transaction_commit`, which automatically defers job enqueueing until the transaction completes.

## Before

Consider a typical pattern where you create a user and send a welcome email:

```ruby
class UsersController < ApplicationController
  def create
    User.transaction do
      @user = User.create!(user_params)
      WelcomeEmailJob.perform_later(@user)
    end
  end
end
```

This code works fine in development where your job queue is slow and transactions commit quickly. In production, with a fast Redis-backed queue like Sidekiq and a busy database, the job can start executing before the transaction commits:

```
Timeline:
1. Transaction begins
2. User INSERT executes (not committed yet)
3. Job enqueued to Redis
4. Sidekiq picks up job immediately
5. Job tries to find User -> RecordNotFound!
6. Transaction commits (too late)
```

The same problem occurs with `after_create` callbacks in models:

```ruby
class Project < ApplicationRecord
  after_create -> { NotifyParticipantsJob.perform_later(self) }
end
```

### The Workaround

The standard fix was to use `after_commit` callbacks instead:

```ruby
class Project < ApplicationRecord
  after_create_commit -> { NotifyParticipantsJob.perform_later(self) }
end
```

Or wrap job scheduling in explicit `after_commit` blocks:

```ruby
class UsersController < ApplicationController
  def create
    User.transaction do
      @user = User.create!(user_params)

      ActiveRecord::Base.connection.after_transaction_commit do
        WelcomeEmailJob.perform_later(@user)
      end
    end
  end
end
```

This worked but had problems:

- **Easy to forget**: Using `after_create` instead of `after_create_commit` is a common mistake
- **Scattered logic**: Job scheduling gets coupled to model callbacks instead of staying in controllers or service objects
- **Verbose**: Wrapping every `perform_later` call in `after_commit` blocks adds boilerplate
- **Testing friction**: Transaction callbacks behave differently in test environments using database cleaner with transactions

The [after_commit_everywhere](https://github.com/Envek/after_commit_everywhere){:target="_blank" rel="noopener noreferrer" aria-label="after_commit_everywhere gem on GitHub (opens in new tab)"} gem became popular specifically to address this problem. It lets you use `after_commit` callbacks anywhere in your application, not just in ActiveRecord models:

```ruby
class UserRegistrationService
  include AfterCommitEverywhere

  def call(params)
    User.transaction do
      user = User.create!(params)

      after_commit do
        WelcomeEmailJob.perform_later(user)
      end
    end
  end
end
```

The gem hooks into ActiveRecord's transaction lifecycle and ensures callbacks only fire after the outermost transaction commits. It handled nested transactions correctly and became a go-to solution for service objects that needed transaction-safe job scheduling.

Some teams built their own lightweight wrappers instead:

```ruby
# Custom AsyncRecord class that hooks into transaction callbacks
class AsyncRecord
  def initialize(&block)
    @callback = block
  end

  def has_transactional_callbacks?
    true
  end

  def committed!(*)
    @callback.call
  end

  def rolledback!(*)
    # Do nothing if transaction rolled back
  end
end

# Usage
User.transaction do
  user = User.create!(params)
  record = AsyncRecord.new { WelcomeEmailJob.perform_later(user) }
  user.class.connection.add_transaction_record(record)
end
```

Both approaches worked, but required teams to remember to use them consistently.

## Rails 7.2

Rails 7.2 makes Active Job transaction-aware. Jobs are automatically deferred until the transaction commits, and dropped if it rolls back.

Enable it globally in your application:

```ruby
# config/application.rb
config.active_job.enqueue_after_transaction_commit = :default
```

Now the original code just works:

```ruby
class UsersController < ApplicationController
  def create
    User.transaction do
      @user = User.create!(user_params)
      WelcomeEmailJob.perform_later(@user)  # Deferred until commit
    end
  end
end
```

The job only gets enqueued after the transaction successfully commits. If the transaction rolls back, the job is never enqueued.

### Configuration Options

You can control this behavior at three levels:

**Global configuration:**

```ruby
# config/application.rb
config.active_job.enqueue_after_transaction_commit = :default
```

**Per-job configuration:**

```ruby
class WelcomeEmailJob < ApplicationJob
  self.enqueue_after_transaction_commit = :always
end

class AuditLogJob < ApplicationJob
  self.enqueue_after_transaction_commit = :never  # Queue immediately
end
```

The available values are:

- `:default` - Let the queue adapter decide the behavior
- `:always` - Always defer until transaction commits
- `:never` - Queue immediately (pre-7.2 behavior)

### Checking Enqueue Status

Since `perform_later` returns immediately even when the job is deferred, you can check if it was actually enqueued:

```ruby
User.transaction do
  user = User.create!(user_params)
  job = WelcomeEmailJob.perform_later(user)

  # job.successfully_enqueued? returns false here (still deferred)
end

# After transaction commits, job.successfully_enqueued? returns true
```

### Model Callbacks Simplified

You can now safely use `after_create` for job scheduling without worrying about transaction timing:

```ruby
class Project < ApplicationRecord
  # This is now safe with enqueue_after_transaction_commit enabled
  after_create -> { NotifyParticipantsJob.perform_later(self) }
end
```

The job automatically waits for any enclosing transaction to complete.

## When to Disable

Some scenarios require immediate enqueueing:

- **Database-backed queues**: If you use Solid Queue, GoodJob, or Delayed Job with the same database, jobs are part of the same transaction and this deferral is unnecessary
- **Fire-and-forget jobs**: Jobs that do not depend on the transaction data can run immediately
- **Time-sensitive operations**: If you need the job queued at a specific moment regardless of transaction state

```ruby
class TimeStampedJob < ApplicationJob
  self.enqueue_after_transaction_commit = :never

  def perform
    # This job needs to capture the exact enqueue time
  end
end
```

## Update: Rails 8.2 Makes This the Default

Rails 8.2 makes `enqueue_after_transaction_commit` the default behavior. Jobs are now automatically deferred until after the transaction commits without requiring explicit configuration.

See [Rails 8.2 makes enqueue_after_transaction_commit the default](/rails-82-enqueue-after-transaction-commit-default){:aria-label="Blog post about Rails 8.2 enqueue_after_transaction_commit default"} for details on the change, opting out, and the deprecation history.

## Conclusion

`enqueue_after_transaction_commit` eliminates a common source of race conditions in Rails applications. Instead of remembering to use `after_commit` callbacks or building custom workarounds, jobs are automatically deferred until transactions complete.

## References

- [Pull Request #51426](https://github.com/rails/rails/pull/51426){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR introducing enqueue_after_transaction_commit (opens in new tab)"} introducing the feature
- [Pull Request #55788](https://github.com/rails/rails/pull/55788){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR making enqueue_after_transaction_commit the default in Rails 8.2 (opens in new tab)"} making this the default in Rails 8.2
- [Original Issue #26045](https://github.com/rails/rails/issues/26045){:target="_blank" rel="noopener noreferrer" aria-label="DHH's original issue about job scheduling in transactions (opens in new tab)"} by DHH describing the problem
- [Active Job Basics Guide](https://guides.rubyonrails.org/active_job_basics.html){:target="_blank" rel="noopener noreferrer" aria-label="Rails Active Job documentation (opens in new tab)"}
