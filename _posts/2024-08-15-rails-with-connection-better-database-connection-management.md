---
layout: post
title:  "Rails with_connection: The better way to manage database connections"
author: prateek
categories: [ Rails, ActiveRecord, Performance ]
tags: [ rails-7-2, activerecord, database-connections, performance-optimization, connection-pooling ]
excerpt: "Rails 7.2 introduced `with_connection` for better database connection management. Learn why you should use it instead of the traditional `connection` method."
description: "Master Rails `with_connection` method for optimized database connection handling in high-concurrency applications, improving performance and resource utilization."
keywords: "Rails with_connection, ActiveRecord connection management, Rails database connections, lease_connection Rails, connection pooling Rails"
---

Rails applications often struggle with database connection management in high-concurrency environments. The traditional `ActiveRecord::Base.connection` method holds connections until the end of the request cycle, potentially exhausting the connection pool.

Since Rails 7.2, there's a better way: `ActiveRecord::Base.with_connection`.

## Before

Previously, when performing database operations, connections were held for the entire request duration:

```ruby
class DataImportService
  def import_large_dataset
    # This holds a connection for the entire method execution
    connection = ActiveRecord::Base.connection

    csv_data.each_slice(1000) do |batch|
      # Long-running operations holding the connection
      process_batch(batch, connection)

      # External API calls still holding the connection
      notify_external_service(batch)
    end
  end

  private

  def process_batch(batch, connection)
    connection.execute("INSERT INTO imports ...")
  end
end
```

This approach leads to:
- Connection pool exhaustion in high-traffic scenarios
- Reduced application throughput
- Database connection timeouts
- Poor resource utilization during I/O operations

## The Better Approach

Rails 7.2 introduced `ActiveRecord::Base.with_connection` which automatically manages connection lifecycle:

```ruby
class DataImportService
  def import_large_dataset
    csv_data.each_slice(1000) do |batch|
      # Connection is only held during database operations
      ActiveRecord::Base.with_connection do |connection|
        process_batch(batch, connection)
      end

      # Connection is released back to pool during API calls
      notify_external_service(batch)
    end
  end

  private

  def process_batch(batch, connection)
    connection.execute("INSERT INTO imports ...")
  end
end
```

The connection is automatically:
- Obtained from the pool when the block starts
- Yielded to the block for database operations
- Returned to the pool when the block completes

## Real-world Example: Parallel Processing

Here's how `with_connection` shines in concurrent scenarios:

```ruby
class BulkUserUpdater
  def update_users_in_parallel
    User.find_in_batches(batch_size: 100) do |user_batch|
      # Process batches in parallel threads
      user_batch.map do |user|
        Thread.new do
          # Each thread gets its own connection from the pool
          ActiveRecord::Base.with_connection do |connection|
            # Perform complex calculations
            analytics_data = fetch_user_analytics(user)

            # Update user with connection
            connection.execute(<<-SQL)
              UPDATE users
              SET last_activity = '#{analytics_data[:last_activity]}',
                  engagement_score = #{analytics_data[:score]}
              WHERE id = #{user.id}
            SQL
          end

          # Connection released while sending emails
          UserMailer.activity_summary(user).deliver_later
        end
      end.each(&:join)
    end
  end
end
```

## The Soft Deprecation

While `ActiveRecord::Base.connection` has been soft deprecated since Rails 7.2, it still works without warnings by default. To see deprecation warnings, you need to explicitly configure:

```ruby
# config/application.rb
ActiveRecord.permanent_connection_checkout = :deprecated

# Now you'll see:
ActiveRecord::Base.connection
# DEPRECATION WARNING: ActiveRecord::Base.connection is deprecated.
# Use #lease_connection instead.
```

The method has been renamed to `lease_connection` to better reflect that it holds the connection for the entire request duration.

## When to Use lease_connection

For cases requiring manual connection management, use `lease_connection`:

```ruby
class LongRunningJob
  def perform
    # Manually lease a connection
    connection = ActiveRecord::Base.lease_connection

    begin
      # Use connection for multiple operations
      connection.transaction do
        update_records(connection)
        generate_reports(connection)
      end
    ensure
      # Must manually release the connection
      ActiveRecord::Base.connection_handler.clear_active_connections!
    end
  end
end
```

Use `lease_connection` when you need:
- Explicit control over connection lifecycle
- A connection across multiple method calls
- Custom connection handling logic

## Performance Benefits

The new approach provides significant improvements:

```ruby
# Benchmark comparing old vs new approach
require 'benchmark'

Benchmark.bm do |x|
  x.report("old approach:") do
    100.times do
      conn = ActiveRecord::Base.connection
      conn.execute("SELECT COUNT(*) FROM users")
      sleep(0.01) # Simulate I/O operation
    end
  end

  x.report("with_connection:") do
    100.times do
      ActiveRecord::Base.with_connection do |conn|
        conn.execute("SELECT COUNT(*) FROM users")
      end
      sleep(0.01) # Connection released during sleep
    end
  end
end

#                      user     system      total        real
# old approach:     0.024548   0.024413   0.048961 (  1.511756)
# with_connection:  0.010594   0.005119   0.015713 (  1.311284)
```

![Rails 8 with_connection Benchmark Results]({{ site.baseurl }}/assets/images/with_connection_benchmark.png)

The results show:
- **15% faster real time** (1.31s vs 1.51s)
- **68% less total CPU time** (0.015s vs 0.048s)
- Better connection pool utilization during I/O operations

## Migration Guide

Update your existing code patterns:

```ruby
# Before
def execute_query
  conn = ActiveRecord::Base.connection
  conn.execute("SELECT * FROM products")
end

# After
def execute_query
  ActiveRecord::Base.with_connection do |conn|
    conn.execute("SELECT * FROM products")
  end
end

# Or for simple cases, just use ActiveRecord methods
def execute_query
  Product.all
end
```

## Conclusion

The new `with_connection` method solves a real problem - connection pool exhaustion during I/O heavy operations. It's a simple change that makes Rails applications handle concurrent requests better without any extra configuration.

## References

- [Pull Request #51083](https://github.com/rails/rails/pull/51083){:target="_blank" rel="nofollow noopener noreferrer"} introducing `with_connection`
- [Pull Request #51230](https://github.com/rails/rails/pull/51230){:target="_blank" rel="nofollow noopener noreferrer"} deprecating `connection` method
- [Rails Connection Handling Documentation](https://api.rubyonrails.org/classes/ActiveRecord/ConnectionHandling.html){:target="_blank" rel="nofollow noopener noreferrer"}
- [Connection Pool Management Guide](https://guides.rubyonrails.org/configuring.html#database-pooling){:target="_blank" rel="nofollow noopener noreferrer"}