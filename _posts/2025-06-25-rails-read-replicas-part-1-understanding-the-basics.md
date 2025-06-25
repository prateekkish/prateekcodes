---
layout: post
title:  "Scaling Rails with PostgreSQL Read Replicas: Part 1 - Understanding the Basics"
author: prateek
categories: [ Rails, PostgreSQL, Database, Scaling ]
excerpt: "Learn when and why to use read replicas in Rails applications, understand the architecture, and implement basic read/write splitting with real-world examples."
---

In this three-part series, we'll explore how to effectively use PostgreSQL read replicas with Rails applications. While the [official Rails guide](https://guides.rubyonrails.org/active_record_multiple_databases.html) covers the configuration basics, implementing read replicas in production requires understanding the nuances that can make or break your application's performance.

## When Do You Actually Need Read Replicas?

Before diving into implementation, let's understand if read replicas are the right solution for your scaling challenges.

### Signs You Need Read Replicas

Your application might benefit from read replicas when:

```ruby
# Your analytics queries are blocking user-facing features
User.joins(:orders)
    .group('users.id')
    .having('COUNT(orders.id) > ?', 100)
    .pluck('users.email, COUNT(orders.id), SUM(orders.total)')
# This query takes 5+ seconds and runs frequently
```

The key indicators are:
- **Read-heavy workload**: Your read:write ratio exceeds 80:20
- **Long-running queries**: Reports and analytics slow down transactional queries
- **Different access patterns**: OLTP (fast transactions) vs OLAP (complex analytics)
- **Geographic distribution**: Users in different regions need low-latency reads

### When Read Replicas Won't Help

Read replicas are not a silver bullet. They won't help if:

1. **Write bottlenecks**: Your database is slow due to heavy writes
2. **Poor query performance**: Unoptimized queries will be slow on replicas too
3. **Real-time requirements**: If you can't tolerate any replication lag

## Understanding PostgreSQL Streaming Replication

PostgreSQL uses streaming replication to keep replicas synchronized. Here's what happens under the hood:

```sql
-- On the primary database
INSERT INTO orders (user_id, total) VALUES (1, 99.99);
-- This generates a WAL (Write-Ahead Log) record

-- The WAL record streams to replicas
-- Replicas apply the change, but with a slight delay
```

This delay, called replication lag, is crucial to understand:

```ruby
# On primary
user = User.create!(name: "Jane")
# user.id = 123

# Immediately on replica (within milliseconds)
User.find(123) # => ActiveRecord::RecordNotFound

# After replication lag (typically < 1 second)
User.find(123) # => #<User id: 123, name: "Jane">
```

## Setting Up Your First Read Replica

Let's implement a basic read replica setup that handles the most common use case: offloading analytics queries.

### Step 1: Database Configuration

First, configure your `database.yml` to define both primary and replica connections:

```yaml
production:
  primary:
    adapter: postgresql
    host: <%= ENV['PRIMARY_DB_HOST'] %>
    database: myapp_production
    username: <%= ENV['DB_USERNAME'] %>
    password: <%= ENV['DB_PASSWORD'] %>
    pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
    
  primary_replica:
    adapter: postgresql
    host: <%= ENV['REPLICA_DB_HOST'] %>
    database: myapp_production
    username: <%= ENV['DB_REPLICA_USERNAME'] %>
    password: <%= ENV['DB_REPLICA_PASSWORD'] %>
    pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
    replica: true  # This marks it as a read-only connection
```

The `replica: true` flag is important—it tells Rails this connection should never receive writes.

### Step 2: Model Configuration

Now, tell your models about these connections:

```ruby
class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true
  
  connects_to database: { 
    writing: :primary, 
    reading: :primary_replica 
  }
end
```

This configuration means:
- All write operations (INSERT, UPDATE, DELETE) go to `:primary`
- Read operations can be directed to `:primary_replica`
- By default, all operations still go to primary (for safety)

### Step 3: Basic Read/Write Splitting

Here's how to explicitly route queries to your replica:

```ruby
class AnalyticsController < ApplicationController
  def revenue_report
    # This block ensures all queries inside use the replica
    ApplicationRecord.connected_to(role: :reading) do
      @revenue_by_month = Order
        .group("DATE_TRUNC('month', created_at)")
        .sum(:total)
        
      @top_customers = User
        .joins(:orders)
        .group('users.id')
        .order('SUM(orders.total) DESC')
        .limit(10)
        .pluck('users.name, SUM(orders.total)')
    end
    
    # Queries here go back to primary
    current_user.update!(last_viewed_report_at: Time.current)
  end
end
```

The `connected_to` block is like a database transaction—everything inside it uses the specified connection.

## Real-World Example: Separating Analytics

Let's build a practical example where analytics queries never impact your main application:

```ruby
# app/models/analytics/base.rb
module Analytics
  class Base < ApplicationRecord
    self.abstract_class = true
    
    # Always use replica for analytics models
    connects_to database: { 
      writing: :primary,
      reading: :primary_replica 
    }
    
    # Force all queries to use replica
    def self.default_role
      :reading
    end
  end
end

# app/models/analytics/user_metrics.rb
module Analytics
  class UserMetrics < Base
    self.table_name = 'users'
    
    def self.monthly_cohort_retention
      # This complex query runs on replica, not affecting login performance
      sql = <<-SQL
        WITH cohorts AS (
          SELECT 
            DATE_TRUNC('month', created_at) as cohort_month,
            id as user_id
          FROM users
        ),
        activities AS (
          SELECT 
            user_id,
            DATE_TRUNC('month', created_at) as activity_month
          FROM orders
          GROUP BY 1, 2
        )
        SELECT 
          cohorts.cohort_month,
          COUNT(DISTINCT cohorts.user_id) as cohort_size,
          COUNT(DISTINCT activities.user_id) as active_users,
          ROUND(100.0 * COUNT(DISTINCT activities.user_id) / 
                COUNT(DISTINCT cohorts.user_id), 2) as retention_rate
        FROM cohorts
        LEFT JOIN activities ON cohorts.user_id = activities.user_id
        GROUP BY 1
        ORDER BY 1
      SQL
      
      connection.exec_query(sql)
    end
  end
end
```

Now your data team can run heavy queries without fear:

```ruby
# This query might take 30 seconds, but won't affect your app
retention_data = Analytics::UserMetrics.monthly_cohort_retention

# Meanwhile, your users can still log in quickly
user = User.find_by(email: params[:email])
user.authenticate(params[:password])
```

## Monitoring Replication Health

You can't use read replicas effectively without monitoring. Here's a simple health check:

```ruby
class ReplicaHealthCheck
  def self.replication_lag
    result = ApplicationRecord.connected_to(role: :reading) do
      ApplicationRecord.connection.execute(<<-SQL).first
        SELECT CASE 
          WHEN pg_is_in_recovery() THEN 
            EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))
          ELSE 0
        END as lag_seconds
      SQL
    end
    
    result['lag_seconds'].to_f.seconds
  end
  
  def self.healthy?
    lag = replication_lag
    lag < 5.seconds
  rescue PG::ConnectionBad
    false
  end
end

# In a monitoring job
Rails.application.config.after_initialize do
  if Rails.env.production?
    Thread.new do
      loop do
        lag = ReplicaHealthCheck.replication_lag
        Rails.logger.info "Replication lag: #{lag}"
        
        # Alert if lag is too high
        if lag > 10.seconds
          AlertService.notify("High replication lag: #{lag}")
        end
        
        sleep 30.seconds
      end
    end
  end
end
```

## Common Pitfalls in Basic Setups

### 1. Accidental Writes to Replicas

```ruby
# This will raise an error
ApplicationRecord.connected_to(role: :reading) do
  User.create!(name: "Bob")  # ActiveRecord::ReadOnlyError
end
```

Rails protects you by default, but always double-check your replica database user has read-only permissions:

```sql
-- On your PostgreSQL replica
CREATE USER replica_user WITH PASSWORD 'secret';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO replica_user;
-- No INSERT, UPDATE, DELETE permissions
```

### 2. Forgetting About Joins

```ruby
# This can cause issues
ApplicationRecord.connected_to(role: :reading) do
  @user = User.find(params[:id])
end

# Later, outside the block
@user.posts.create!(title: "New Post")  # This might try to use replica!
```

Solution: Load all associations within the connection block:

```ruby
ApplicationRecord.connected_to(role: :reading) do
  @user = User.includes(:posts, :profile).find(params[:id])
end
```

## What's Next?

In this part, we covered the fundamentals:
- When to use read replicas
- Basic configuration and setup
- Simple read/write splitting
- Monitoring basics

In [Part 2](/rails-read-replicas-part-2-advanced-patterns), we'll tackle the challenging aspects:
- Handling replication lag with sticky sessions
- Automatic connection switching
- Advanced routing patterns
- Connection pool management

Then in [Part 3](/rails-read-replicas-part-3-production-excellence), we'll cover production excellence:
- Zero-downtime deployment strategies
- Multi-replica load balancing
- Failure handling and circuit breakers
- Performance optimization techniques

Remember: start simple. Begin by moving just your analytics queries to replicas and expand from there. The goal is to improve performance without adding unnecessary complexity.