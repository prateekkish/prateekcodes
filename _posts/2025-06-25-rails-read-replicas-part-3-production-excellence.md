---
layout: post
title:  "Scaling Rails with PostgreSQL Read Replicas: Part 3 - Production Excellence"
author: prateek
categories: [ Rails, PostgreSQL, Database, Scaling ]
excerpt: "Master production deployment strategies, monitoring, performance optimization, and failure handling for Rails applications using PostgreSQL read replicas."
---

In [Part 1](/rails-read-replicas-part-1-understanding-the-basics) and [Part 2](/rails-read-replicas-part-2-advanced-patterns), we covered setup and advanced patterns. Now let's focus on running read replicas successfully in production—the strategies that separate systems that merely work from those that excel.

## Zero-Downtime Deployment Strategy

Adding read replicas to an existing production application requires careful planning. Here's a battle-tested approach:

### Step 1: Shadow Mode Deployment

Start by routing 0% of traffic to replicas while monitoring their behavior:

```ruby
# app/services/replica_shadow_runner.rb
class ReplicaShadowRunner
  def self.shadow_run(&block)
    primary_result = nil
    replica_result = nil
    replica_error = nil
    
    # Run on primary (user sees this)
    primary_start = Time.current
    primary_result = yield
    primary_duration = Time.current - primary_start
    
    # Run on replica in background (user doesn't wait)
    Thread.new do
      begin
        replica_start = Time.current
        ApplicationRecord.connected_to(role: :reading) do
          replica_result = yield
        end
        replica_duration = Time.current - replica_start
        
        # Compare results
        if primary_result != replica_result
          Rails.logger.warn(
            "Replica divergence detected",
            primary: primary_result.inspect,
            replica: replica_result.inspect
          )
        end
        
        # Track metrics
        StatsD.histogram('db.query.primary.duration', primary_duration)
        StatsD.histogram('db.query.replica.duration', replica_duration)
        StatsD.gauge('db.query.replica.lag', replica_duration - primary_duration)
        
      rescue => e
        replica_error = e
        Rails.logger.error("Replica shadow run failed: #{e.message}")
        StatsD.increment('db.replica.shadow.errors')
      end
    end
    
    primary_result
  end
end

# Use in controllers during shadow phase
class ProductsController < ApplicationController
  def index
    @products = ReplicaShadowRunner.shadow_run do
      Product.active.includes(:category).page(params[:page])
    end
  end
end
```

### Step 2: Gradual Traffic Migration

Once shadow mode shows replicas are healthy, gradually migrate traffic:

```ruby
# app/services/replica_traffic_manager.rb
class ReplicaTrafficManager
  MIGRATION_SCHEDULE = [
    { percentage: 0, duration: 1.day },    # Shadow mode
    { percentage: 5, duration: 1.hour },   # 5% of reads
    { percentage: 10, duration: 2.hours }, # Monitor closely
    { percentage: 25, duration: 4.hours },
    { percentage: 50, duration: 1.day },
    { percentage: 75, duration: 1.day },
    { percentage: 100, duration: nil }     # Full migration
  ].freeze
  
  def self.current_percentage
    migration_start = Rails.cache.read('replica_migration_start') || Time.current
    elapsed = Time.current - migration_start
    
    MIGRATION_SCHEDULE.each_with_index do |phase, index|
      next_phase = MIGRATION_SCHEDULE[index + 1]
      
      if phase[:duration].nil? || elapsed < phase[:duration]
        return phase[:percentage]
      end
      
      elapsed -= phase[:duration]
    end
    
    100 # Full migration complete
  end
  
  def self.should_use_replica?(feature: :default)
    percentage = current_percentage
    
    # Critical features migrate last
    percentage = [percentage - 20, 0].max if [:payments, :auth].include?(feature)
    
    rand(100) < percentage
  end
  
  def self.with_traffic_management(feature: :default, &block)
    if should_use_replica?(feature: feature) && ReplicaHealthCheck.healthy?
      ApplicationRecord.connected_to(role: :reading, &block)
    else
      yield
    end
  rescue => e
    # Always fallback to primary on errors
    ErrorTracker.track(e, context: { feature: feature })
    yield
  end
end
```

### Step 3: Automated Rollback

Build automatic rollback when issues arise:

```ruby
# app/services/replica_circuit_breaker.rb
class ReplicaCircuitBreaker
  FAILURE_THRESHOLD = 5
  TIMEOUT_THRESHOLD = 10.seconds
  RECOVERY_TIMEOUT = 1.minute
  
  class << self
    def call(&block)
      return yield if circuit_open?
      
      execute_with_breaker(&block)
    end
    
    private
    
    def execute_with_breaker(&block)
      start_time = Time.current
      
      result = ApplicationRecord.connected_to(role: :reading, &block)
      
      # Reset failures on success
      reset_failure_count
      result
      
    rescue => e
      record_failure(e, Time.current - start_time)
      
      # Fallback to primary
      yield
    end
    
    def circuit_open?
      return false unless last_failure_time
      
      # Check if we're still in recovery period
      Time.current - last_failure_time < RECOVERY_TIMEOUT
    end
    
    def record_failure(error, duration)
      increment_failure_count
      
      if failure_count >= FAILURE_THRESHOLD || duration > TIMEOUT_THRESHOLD
        open_circuit
        AlertService.critical(
          "Replica circuit breaker opened",
          error: error.message,
          failure_count: failure_count,
          duration: duration
        )
      end
    end
    
    def open_circuit
      Rails.cache.write('replica:circuit:open', true, expires_in: RECOVERY_TIMEOUT)
      Rails.cache.write('replica:circuit:opened_at', Time.current)
    end
    
    def failure_count
      Rails.cache.read('replica:circuit:failures').to_i
    end
    
    def increment_failure_count
      Rails.cache.increment('replica:circuit:failures', 1, expires_in: 5.minutes)
    end
    
    def reset_failure_count
      Rails.cache.delete('replica:circuit:failures')
    end
    
    def last_failure_time
      Rails.cache.read('replica:circuit:opened_at')
    end
  end
end
```

## Comprehensive Monitoring

Production read replicas need multi-layered monitoring:

### Database-Level Monitoring

```ruby
# app/services/replica_monitor.rb
class ReplicaMonitor
  def self.check_all
    {
      replication_lag: check_replication_lag,
      connection_stats: check_connections,
      query_performance: check_query_performance,
      disk_usage: check_disk_usage,
      long_running_queries: check_long_queries
    }
  end
  
  private
  
  def self.check_replication_lag
    replicas = ApplicationRecord.configurations.configs_for(role: :reading)
    
    replicas.map do |config|
      ApplicationRecord.connected_to(role: :reading, shard: config.name.to_sym) do
        lag_query = <<-SQL
          SELECT 
            pg_is_in_recovery() as is_replica,
            pg_last_wal_receive_lsn() as receive_lsn,
            pg_last_wal_replay_lsn() as replay_lsn,
            EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) as lag_seconds,
            pg_last_xact_replay_timestamp() as last_replay_time
        SQL
        
        result = ApplicationRecord.connection.exec_query(lag_query).first
        
        {
          name: config.name,
          lag_seconds: result['lag_seconds']&.to_f || 0,
          lag_bytes: calculate_lag_bytes(result['receive_lsn'], result['replay_lsn']),
          last_replay: result['last_replay_time'],
          healthy: (result['lag_seconds']&.to_f || 0) < 5.0
        }
      end
    end
  end
  
  def self.check_connections
    ApplicationRecord.connected_to(role: :reading) do
      stats = ApplicationRecord.connection.exec_query(<<-SQL).first
        SELECT 
          COUNT(*) FILTER (WHERE state = 'active') as active_connections,
          COUNT(*) FILTER (WHERE state = 'idle') as idle_connections,
          COUNT(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
          COUNT(*) as total_connections,
          MAX(EXTRACT(EPOCH FROM (now() - state_change))) as longest_connection_seconds
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
      SQL
      
      {
        active: stats['active_connections'],
        idle: stats['idle_connections'],
        idle_in_transaction: stats['idle_in_transaction'],
        total: stats['total_connections'],
        longest_duration: stats['longest_connection_seconds']&.to_f,
        pool_exhaustion_risk: stats['total_connections'] > 80
      }
    end
  end
  
  def self.check_query_performance
    ApplicationRecord.connected_to(role: :reading) do
      slow_queries = ApplicationRecord.connection.exec_query(<<-SQL)
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          max_time,
          stddev_time
        FROM pg_stat_statements
        WHERE query NOT LIKE '%pg_stat_statements%'
        ORDER BY mean_time DESC
        LIMIT 10
      SQL
      
      slow_queries.map(&:to_h)
    end
  end
  
  def self.calculate_lag_bytes(receive_lsn, replay_lsn)
    return 0 unless receive_lsn && replay_lsn
    
    # PostgreSQL LSN format: XXXXXXXX/YYYYYYYY
    receive_bytes = lsn_to_bytes(receive_lsn)
    replay_bytes = lsn_to_bytes(replay_lsn)
    
    receive_bytes - replay_bytes
  end
  
  def self.lsn_to_bytes(lsn)
    high, low = lsn.split('/').map { |x| x.to_i(16) }
    (high << 32) + low
  end
end
```

### Application-Level Monitoring

Track how your application uses replicas:

```ruby
# config/initializers/replica_instrumentation.rb
ActiveSupport::Notifications.subscribe('sql.active_record') do |*args|
  event = ActiveSupport::Notifications::Event.new(*args)
  
  # Determine which connection was used
  connection_name = event.payload[:connection]&.pool&.db_config&.name || 'unknown'
  role = event.payload[:connection]&.pool&.db_config&.configuration_hash&.dig(:replica) ? 'replica' : 'primary'
  
  # Track metrics
  tags = {
    role: role,
    connection: connection_name,
    operation: extract_operation(event.payload[:sql])
  }
  
  StatsD.histogram('db.query.duration', event.duration, tags: tags)
  StatsD.increment('db.query.count', tags: tags)
  
  # Alert on slow replica queries
  if role == 'replica' && event.duration > 1000
    Rails.logger.warn(
      "Slow replica query",
      duration: event.duration,
      sql: event.payload[:sql],
      connection: connection_name
    )
  end
end

def extract_operation(sql)
  case sql
  when /^SELECT/i then 'select'
  when /^INSERT/i then 'insert'
  when /^UPDATE/i then 'update'
  when /^DELETE/i then 'delete'
  else 'other'
  end
end
```

## Performance Optimization

### 1. Query Optimization for Replicas

Some queries perform differently on replicas:

```ruby
# app/models/concerns/replica_optimized.rb
module ReplicaOptimized
  extend ActiveSupport::Concern
  
  class_methods do
    def replica_optimized_scope(name, &block)
      # Define two versions of the scope
      scope "#{name}_primary", block
      scope "#{name}_replica", block
      
      # Smart scope that picks the right version
      define_singleton_method(name) do |*args|
        if ApplicationRecord.current_role == :reading
          send("#{name}_replica", *args)
        else
          send("#{name}_primary", *args)
        end
      end
    end
  end
end

class Product < ApplicationRecord
  include ReplicaOptimized
  
  # Regular scope for primary
  replica_optimized_scope :search do |term|
    where("name ILIKE ?", "%#{term}%")
  end
  
  # Override for replica with better performance
  def self.search_replica(term)
    # Use full-text search on replica (assuming GIN index)
    where("search_vector @@ plainto_tsquery('english', ?)", term)
  end
  
  # Materialized view only on replica
  def self.top_selling_replica
    # This materialized view is refreshed hourly on replicas
    connection.exec_query(
      "SELECT * FROM top_selling_products_mv LIMIT 100"
    )
  end
end
```

### 2. Connection Pool Tuning

Optimize pools based on actual usage:

```ruby
# app/services/connection_pool_optimizer.rb
class ConnectionPoolOptimizer
  def self.auto_tune!
    Thread.new do
      loop do
        sleep 5.minutes
        
        tune_pools
      end
    end
  end
  
  private
  
  def self.tune_pools
    configs = ApplicationRecord.configurations.configs_for(env_name: Rails.env)
    
    configs.each do |config|
      pool = ApplicationRecord.connection_handler.retrieve_connection_pool(config.name)
      next unless pool
      
      stats = pool_statistics(pool)
      
      if stats[:wait_count] > 10
        # Pool is too small
        recommendation = (pool.size * 1.5).to_i
        Rails.logger.info(
          "Pool #{config.name} should be increased to #{recommendation}",
          current_size: pool.size,
          wait_count: stats[:wait_count]
        )
      elsif stats[:usage_ratio] < 0.3
        # Pool is too large
        recommendation = [(pool.size * 0.7).to_i, 5].max
        Rails.logger.info(
          "Pool #{config.name} could be reduced to #{recommendation}",
          current_size: pool.size,
          usage_ratio: stats[:usage_ratio]
        )
      end
    end
  end
  
  def self.pool_statistics(pool)
    {
      size: pool.size,
      connections: pool.connections.size,
      busy: pool.connections.count(&:in_use?),
      dead: pool.connections.count(&:disconnected?),
      wait_count: pool.stat[:wait_count],
      usage_ratio: pool.connections.count(&:in_use?).to_f / pool.size
    }
  end
end

# Start auto-tuning in production
ConnectionPoolOptimizer.auto_tune! if Rails.env.production?
```

### 3. Multi-Region Optimization

For global applications, use region-aware routing:

```ruby
# app/services/region_aware_router.rb
class RegionAwareRouter
  REGION_REPLICAS = {
    'us-east' => :replica_us_east,
    'us-west' => :replica_us_west,
    'eu-west' => :replica_eu_west,
    'ap-south' => :replica_ap_south
  }.freeze
  
  def self.nearest_replica(request)
    region = detect_region(request)
    REGION_REPLICAS[region] || :primary_replica
  end
  
  def self.with_nearest_replica(request, &block)
    replica = nearest_replica(request)
    
    ApplicationRecord.connected_to(role: :reading, shard: replica) do
      yield
    end
  rescue => e
    # Fallback to primary region replica
    Rails.logger.warn("Region replica failed: #{replica}, error: #{e.message}")
    ApplicationRecord.connected_to(role: :reading, &block)
  end
  
  private
  
  def self.detect_region(request)
    # Use CloudFlare header
    return request.headers['CF-IPCountry'] if request.headers['CF-IPCountry']
    
    # Use AWS region detection
    return request.headers['CloudFront-Viewer-Country'] if request.headers['CloudFront-Viewer-Country']
    
    # Fallback to IP geolocation
    geoip_region(request.remote_ip)
  end
  
  def self.geoip_region(ip)
    # Implement GeoIP lookup
    # Return region like 'us-east', 'eu-west', etc.
  end
end

# Use in ApplicationController
class ApplicationController < ActionController::Base
  around_action :use_nearest_replica, if: :get_request?
  
  private
  
  def use_nearest_replica
    RegionAwareRouter.with_nearest_replica(request) do
      yield
    end
  end
end
```

## Disaster Recovery

### Automatic Failover

Handle replica failures gracefully:

```ruby
# app/services/replica_failover_manager.rb
class ReplicaFailoverManager
  class << self
    def healthy_replicas
      @healthy_replicas ||= {}
    end
    
    def mark_unhealthy(replica_name, error)
      healthy_replicas[replica_name] = {
        healthy: false,
        error: error.message,
        failed_at: Time.current
      }
      
      AlertService.notify(
        "Replica marked unhealthy: #{replica_name}",
        error: error.message
      )
    end
    
    def check_replica_health(replica_name)
      return false if healthy_replicas[replica_name]&.dig(:healthy) == false
      
      ApplicationRecord.connected_to(role: :reading, shard: replica_name) do
        ApplicationRecord.connection.exec_query("SELECT 1")
        true
      end
    rescue => e
      mark_unhealthy(replica_name, e)
      false
    end
    
    def with_failover(&block)
      available_replicas = [:primary_replica, :primary_replica_2, :primary_replica_3]
      
      available_replicas.each do |replica|
        next unless check_replica_health(replica)
        
        begin
          return ApplicationRecord.connected_to(role: :reading, shard: replica, &block)
        rescue => e
          Rails.logger.error("Replica #{replica} failed during query: #{e.message}")
          mark_unhealthy(replica, e)
        end
      end
      
      # All replicas failed, use primary
      Rails.logger.warn("All replicas unhealthy, falling back to primary")
      yield
    end
  end
  
  # Background health checker
  def self.start_health_checker!
    Thread.new do
      loop do
        sleep 30.seconds
        
        healthy_replicas.each do |replica_name, status|
          next if status[:healthy]
          
          # Try to recover unhealthy replicas
          if Time.current - status[:failed_at] > 5.minutes
            if check_replica_health(replica_name)
              healthy_replicas[replica_name] = { healthy: true }
              AlertService.notify("Replica recovered: #{replica_name}")
            end
          end
        end
      end
    end
  end
end
```

## Production Checklist

Before going live with read replicas:

1. **Monitoring**
   - ✓ Replication lag alerts (< 5 seconds)
   - ✓ Connection pool monitoring
   - ✓ Query performance tracking
   - ✓ Error rate monitoring

2. **Testing**
   - ✓ Load testing with realistic read/write ratios
   - ✓ Failover testing
   - ✓ Replication lag simulation
   - ✓ Connection pool exhaustion testing

3. **Operations**
   - ✓ Runbook for replica issues
   - ✓ Automated health checks
   - ✓ Circuit breakers configured
   - ✓ Gradual rollout plan

4. **Performance**
   - ✓ Replica-specific indexes created
   - ✓ Connection pools tuned
   - ✓ Query routing optimized
   - ✓ Region-aware routing (if needed)

## Conclusion

Successfully running read replicas in production requires:

1. **Gradual adoption** - Start with shadow mode, increase traffic slowly
2. **Comprehensive monitoring** - Track everything from replication lag to query patterns
3. **Automatic recovery** - Build systems that heal themselves
4. **Performance focus** - Optimize specifically for replica characteristics

Read replicas are powerful but complex. Start simple, measure everything, and build sophistication as your needs grow. The patterns in this series will help you scale your Rails application while maintaining reliability and performance.