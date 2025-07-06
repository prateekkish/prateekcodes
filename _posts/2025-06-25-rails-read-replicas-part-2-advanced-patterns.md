---
layout: post
title:  "Scaling Rails with PostgreSQL Read Replicas: Part 2 - Advanced Patterns and Gotchas"
author: prateek
categories: [ Rails, Rails 7, PostgreSQL, Database, Scaling ]
tags: [ rails-read-replicas, replication-lag, connection-switching, sticky-sessions, rails-7, postgresql, database-patterns ]
excerpt: "Deep dive into handling replication lag, implementing automatic connection switching, and solving real-world challenges with read replicas in Rails applications."
description: "Master advanced Rails read replica patterns: handle replication lag, implement sticky sessions, optimize connection pools, and solve production challenges with battle-tested solutions."
keywords: "Rails read replica patterns, replication lag Rails, sticky sessions Rails, connection pool optimization, Rails database scaling patterns, PostgreSQL replication lag"
---

In [Part 1](/rails-read-replicas-part-1-understanding-the-basics), we covered the basics of setting up read replicas. Now let's tackle the challenging aspects that make the difference between a system that works in development and one that thrives in production.

## What's Covered

- [The Replication Lag Challenge](#the-replication-lag-challenge)
- [Implementing Sticky Sessions](#implementing-sticky-sessions)
- [Advanced Query Routing Patterns](#advanced-query-routing-patterns)
- [Connection Pool Management](#connection-pool-management)
- [Handling Edge Cases](#handling-edge-cases)
- [Testing with Replicas](#testing-with-replicas)

## The Replication Lag Challenge

The biggest challenge with read replicas is replication lag—the delay between when data is written to the primary and when it appears on replicas. Let's understand why this matters.

### The "Invisible Update" Problem

Here's a scenario that can be frustrating:

```ruby
class ProfilesController < ApplicationController
  def update
    @user = current_user
    @user.update!(bio: params[:bio])
    
    redirect_to profile_path(@user)
  end
  
  def show
    # If this runs on a replica, user might see old data!
    @user = User.find(params[:id])
  end
end
```

The user updates their bio and gets redirected, but they see their old bio because the `show` action read from a replica that hadn't received the update yet.

## Implementing Sticky Sessions

Rails provides automatic connection switching to solve this problem through the [DatabaseSelector middleware](https://api.rubyonrails.org/classes/ActiveRecord/Middleware/DatabaseSelector.html){:target="_blank" rel="nofollow noopener noreferrer"}.

### Basic Configuration

```ruby
# config/environments/production.rb
Rails.application.configure do
  config.active_record.database_selector = { delay: 2.seconds }
  config.active_record.database_resolver = 
    ActiveRecord::Middleware::DatabaseSelector::Resolver
  config.active_record.database_resolver_context = 
    ActiveRecord::Middleware::DatabaseSelector::Resolver::Session
end
```

This configuration creates "sticky sessions"—after a write operation, that user's session reads from the primary database for 2 seconds, ensuring they see their own changes. 

You can generate this configuration automatically using:
```bash
rails generate active_record:multi_db
```

(See [Rails Guide on Activating Automatic Role Switching](https://guides.rubyonrails.org/active_record_multiple_databases.html#activating-automatic-role-switching){:target="_blank" rel="nofollow noopener noreferrer"})

### How Sticky Sessions Work

Let's trace through what happens:

```ruby
# 1. User makes a POST request to update their profile
# POST /profile
def update
  current_user.update!(bio: "New bio")  # Write to primary
  # Rails automatically stores timestamp: session[:last_write_timestamp] = Time.current
  redirect_to profile_path
end

# 2. Browser follows redirect
# GET /profile
def show
  # Rails middleware checks: Time.current - session[:last_write_timestamp] < 2.seconds
  # Since it's within 2 seconds, this query goes to PRIMARY, not replica
  @user = current_user
end

# 3. User refreshes page 3 seconds later
# GET /profile
def show
  # Now: Time.current - session[:last_write_timestamp] > 2.seconds
  # This query can safely go to REPLICA
  @user = current_user
end
```

### Customizing Sticky Session Behavior

The default 2-second delay works for many apps, but sometimes you need more control. For example:
- Financial transactions need longer consistency windows
- Critical paths like checkout flows should always use primary
- Different operations have different consistency requirements

Here's a custom resolver that addresses these needs:

```ruby
# app/middleware/custom_database_resolver.rb
class CustomDatabaseResolver < ActiveRecord::Middleware::DatabaseSelector::Resolver
  CRITICAL_PATHS = %w[/checkout /payment /account].freeze
  
  def read_from_primary?(request)
    # Always use primary for critical paths
    return true if CRITICAL_PATHS.any? { |path| request.path.start_with?(path) }
    
    # Check if we recently wrote data
    return true if recently_wrote?(request)
    
    # Use primary for non-GET requests
    !request.get? && !request.head?
  end
  
  private
  
  def recently_wrote?(request)
    last_write = last_write_timestamp(request)
    return false unless last_write
    
    # Different delays for different operations
    delay = if request.session[:critical_write]
      10.seconds  # Financial operations need longer consistency
    else
      2.seconds   # Normal operations
    end
    
    Time.current - last_write < delay
  end
  
  def last_write_timestamp(request)
    timestamp = request.session[:last_write_timestamp]
    return nil unless timestamp
    
    Time.at(timestamp.to_i)
  end
end

# Use the custom resolver
Rails.application.configure do
  config.active_record.database_resolver = CustomDatabaseResolver
end
```

## Advanced Query Routing Patterns

Beyond sticky sessions, you need patterns for routing specific queries intelligently.

### Pattern 1: Smart Query Router

Build a router that intelligently decides where queries should go:

```ruby
# app/services/smart_query_router.rb
class SmartQueryRouter
  # Queries safe for replicas even with lag
  REPLICA_SAFE_PATTERNS = {
    analytics: /GROUP BY|COUNT\(\*\)|SUM\(|AVG\(/i,
    historical: /created_at < '#{1.hour.ago}'/,
    reference_data: /countries|currencies|categories/
  }.freeze
  
  def self.route(model_class, &block)
    sql = capture_sql(&block)
    
    if should_use_replica?(model_class, sql)
      model_class.connected_to(role: :reading, &block)
    else
      yield
    end
  end
  
  private
  
  def self.should_use_replica?(model_class, sql)
    # Never use replica for write operations
    return false if sql =~ /INSERT|UPDATE|DELETE/i
    
    # Check if query matches safe patterns
    REPLICA_SAFE_PATTERNS.any? do |_type, pattern|
      sql =~ pattern
    end
  end
  
  def self.capture_sql(&block)
    queries = []
    subscriber = ActiveSupport::Notifications.subscribe('sql.active_record') do |*args|
      event = ActiveSupport::Notifications::Event.new(*args)
      queries << event.payload[:sql]
    end
    
    yield
    queries.join(' ')
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber)
  end
end

# Usage
SmartQueryRouter.route(Order) do
  Order.where('created_at < ?', 1.month.ago).sum(:total)
end
# Automatically routed to replica because it's historical data
```

### Pattern 2: Gradual Replica Adoption

Rolling out replicas gradually reduces risk:

```ruby
# app/services/replica_rollout.rb
class ReplicaRollout
  ROLLOUT_PERCENTAGES = {
    analytics_queries: 100,  # 100% of analytics use replicas
    search_queries: 50,      # 50% of searches use replicas
    user_profiles: 10,       # 10% of profile reads use replicas
    default: 0               # Everything else uses primary
  }.freeze
  
  def self.with_smart_routing(query_type = :default, &block)
    percentage = ROLLOUT_PERCENTAGES[query_type] || 0
    
    if should_use_replica?(percentage)
      begin
        ApplicationRecord.connected_to(role: :reading, &block)
      rescue => e
        # Fallback to primary on any replica issues
        Rails.logger.error "Replica failed: #{e.message}, falling back to primary"
        yield
      end
    else
      yield
    end
  end
  
  private
  
  def self.should_use_replica?(percentage)
    # Use request ID for consistent routing per request
    request_id = Thread.current[:request_id] || SecureRandom.uuid
    Digest::MD5.hexdigest(request_id).to_i(16) % 100 < percentage
  end
end

# Usage in controllers
class SearchController < ApplicationController
  def index
    ReplicaRollout.with_smart_routing(:search_queries) do
      @results = Product.search(params[:q])
    end
  end
end
```

### Pattern 3: Read-Your-Writes for Specific Models

The need for immediate consistency could be at the model level. Here's a way to achieve that:

```ruby
# app/models/concerns/immediate_consistency.rb
module ImmediateConsistency
  extend ActiveSupport::Concern
  
  included do
    # Override connection to always use primary for this model
    def self.connection
      return super unless ActiveRecord::Base.current_role == :reading
      
      ActiveRecord::Base.connected_to(role: :writing) do
        return super
      end
    end
  end
end

# Models that need immediate consistency
class PaymentTransaction < ApplicationRecord
  include ImmediateConsistency
  # All queries for this model use primary, even in a reading block
end

class UserSession < ApplicationRecord
  include ImmediateConsistency
  # Session data must always be current
end
```

**⚠️ Warning**: I do not recommend this pattern unless you know what you're doing. It can be very easy to go wrong because:
- The behavior is "magical" and not obvious to other developers
- Users of this model may see unintended behavior
- It overrides core Rails methods in non-obvious ways
- Debugging becomes difficult when queries don't go where expected

Consider explicit methods or service objects instead for better clarity.

## Connection Pool Management

Read replicas require careful connection pool management to avoid exhaustion. This builds on Rails' [improved connection management with `with_connection`](/rails-with-connection-better-database-connection-management){:target="_blank"} which helps prevent connection pool exhaustion:

### Understanding the Problem

When you add read replicas, your connection usage multiplies. Each database configuration maintains its own connection pool, and these pools exist per process.

Consider a typical setup:
- 1 primary database
- 2 read replicas
- 5 connections per pool (Rails default)
- 10 Puma workers

This creates 150 total database connections (3 databases × 5 connections × 10 workers). Many databases have connection limits—PostgreSQL defaults to 100 connections. You'll hit the limit before your application even starts serving traffic.

For a deeper understanding of connection pools, see the [Rails Connection Pool documentation](https://api.rubyonrails.org/classes/ActiveRecord/ConnectionAdapters/ConnectionPool.html){:target="_blank" rel="nofollow noopener noreferrer"} and this excellent article on [PostgreSQL connection pooling](https://www.postgresql.org/docs/current/runtime-config-connection.html){:target="_blank" rel="nofollow noopener noreferrer"}.

### Optimizing Connection Pools

The key is to right-size your pools based on actual usage patterns. Primary databases handle all writes and need more connections, while replicas only handle reads and can work with fewer connections. Additionally, replicas can return idle connections more aggressively since read queries are typically shorter.

Here's how to configure pools efficiently:

```ruby
# config/database.yml
production:
  primary:
    pool: <%= ENV.fetch("PRIMARY_DB_POOL", 5) %>
    # Keep more connections for primary (handles all writes)
    
  primary_replica:
    pool: <%= ENV.fetch("REPLICA_DB_POOL", 3) %>
    # Fewer connections per replica, but we have multiple replicas
    idle_timeout: 300  # Return idle connections faster
    checkout_timeout: 2  # Fail fast if no connections available
    
  primary_replica_2:
    pool: <%= ENV.fetch("REPLICA_DB_POOL", 3) %>
    idle_timeout: 300
    checkout_timeout: 2

# app/models/application_record.rb
class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true
  
  # Distribute reads across multiple replicas
  connects_to database: { 
    writing: :primary,
    reading: [:primary_replica, :primary_replica_2].sample
  }
  
  # Better: Use a load balancer
  class << self
    def reading_connection
      replicas = [:primary_replica, :primary_replica_2]
      replica = LoadBalancer.least_connections(replicas)
      
      configurations.configs_for(env_name: Rails.env, name: replica.to_s)
    end
  end
end
```

### Per-Feature Connection Pools

Different features need different pool sizes:

```ruby
# config/database.yml
production:
  # Analytics jobs need more connections
  analytics_replica:
    <<: *replica_config
    pool: 10
    
  # API endpoints need fewer but faster connections  
  api_replica:
    <<: *replica_config
    pool: 3
    checkout_timeout: 1
    
# app/jobs/analytics_job.rb
class AnalyticsJob < ApplicationJob
  around_perform do |job, block|
    ApplicationRecord.connected_to(role: :reading, shard: :analytics_replica) do
      block.call
    end
  end
end
```

## Handling Edge Cases

### 1. Cross-Database Joins

Read replicas complicate joins across different models:

```ruby
# This breaks with replicas
def user_with_recent_orders
  ApplicationRecord.connected_to(role: :reading) do
    user = User.find(params[:id])  # From replica
  end
  
  # This might use primary, causing a cross-database join attempt
  user.orders.where('created_at > ?', 1.day.ago)
end

# Solution: Load everything in the same connection block
def user_with_recent_orders
  ApplicationRecord.connected_to(role: :reading) do
    User.includes(:orders)
        .where(id: params[:id])
        .where(orders: { created_at: 1.day.ago.. })
        .first
  end
end
```

### 2. Transactions Across Connections

```ruby
# This won't work as expected
ApplicationRecord.transaction do
  user = User.create!(name: "Alice")  # Primary
  
  ApplicationRecord.connected_to(role: :reading) do
    # This runs outside the transaction!
    Analytics.create!(user_id: user.id)
  end
end

# Solution: Keep transactions on single connection
ApplicationRecord.transaction do
  user = User.create!(name: "Alice")
  
  # Explicitly use primary for analytics within transaction
  Analytics.connected_to(role: :writing) do
    Analytics.create!(user_id: user.id)
  end
end
```

## Testing with Replicas

Testing replica behavior requires special setup:

```ruby
# spec/support/replica_test_helper.rb
module ReplicaTestHelper
  def with_replica_lag(seconds)
    # Simulate lag by delaying replica queries
    allow(ApplicationRecord).to receive(:connected_to).and_wrap_original do |method, **options, &block|
      if options[:role] == :reading
        sleep(seconds)
      end
      method.call(**options, &block)
    end
    
    yield
  end
  
  def assert_uses_replica(&block)
    expect(ApplicationRecord).to receive(:connected_to).with(role: :reading)
    block.call
  end
  
  def assert_uses_primary(&block)
    expect(ApplicationRecord).not_to receive(:connected_to).with(role: :reading)
    block.call
  end
end

# spec/controllers/profiles_controller_spec.rb
RSpec.describe ProfilesController do
  include ReplicaTestHelper
  
  it "uses primary database after writes" do
    post :update, params: { bio: "New bio" }
    
    assert_uses_primary do
      get :show
    end
  end
  
  it "handles replica lag gracefully" do
    with_replica_lag(0.5) do
      get :analytics
      expect(response).to be_successful
    end
  end
end
```

## What's Next?

Make sure to check out:
- [Part 3 - Production Excellence](/rails-read-replicas-part-3-production-excellence)

Remember: complexity should match your needs. Start with Rails' built-in connection switching and add custom routing as specific use cases demand it.