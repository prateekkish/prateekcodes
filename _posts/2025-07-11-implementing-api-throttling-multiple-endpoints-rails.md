---
layout: post
title: "Rails API Throttling: Handling Multiple Endpoints with Different Limits"
author: prateek
categories: [ Rails, API, Performance ]
tags: [ rails, api, throttling, rate-limiting, external-api, redis ]
excerpt: "Learn how to implement intelligent rate limiting for external APIs with different limits per endpoint, ensuring your Rails app respects third-party API constraints"
description: "A comprehensive guide to implementing API throttling in Rails applications for external APIs with varying rate limits across different endpoints. Includes Redis-based implementation with automatic retry mechanisms."
keywords: "rails api throttling, rails rate limiting, external api rate limit, multiple endpoint throttling, redis rate limiter rails, api request throttling, handle api rate limits rails, throttle external api calls"
---

When integrating with external APIs, respecting rate limits isn't optional—it's essential. But what happens when different endpoints have different limits? Let's build a robust throttling system that handles this complexity gracefully.

## The Challenge

Imagine you're integrating with a payment provider API that has these rate limits:
- `/transactions`: 100 requests per minute
- `/refunds`: 20 requests per minute
- `/reports`: 5 requests per hour

Exceeding any limit results in a 429 error and potential temporary bans. We need a solution that tracks and respects these varying limits automatically.

## Building the Foundation

Let's start by creating a flexible throttling system that can handle multiple endpoints with different rate limits. We'll use Redis for distributed rate limiting and build a clean abstraction layer.

**Note:** While you could achieve similar throttling using [Sidekiq's middleware](https://github.com/sidekiq/sidekiq/wiki/middleware){:target="_blank" rel="noopener noreferrer" aria-label="Sidekiq middleware documentation (opens in new tab)"} or other pre-built solutions, this post approaches the problem from a design perspective. We'll build our own implementation to understand the underlying concepts and create a solution tailored to our specific needs.

### Setting Up the Rate Limiter

First, let's create a rate limiter class that handles the core throttling logic:

```ruby
# app/services/api_rate_limiter.rb
class ApiRateLimiter
  class RateLimitExceeded < StandardError; end

  def initialize(redis: Redis.current)
    @redis = redis
  end

  # Checks if a request can be made within the rate limit
  # Increments the counter and raises an exception if limit is exceeded
  def check_limit!(endpoint, limit:, period:)
    key = build_key(endpoint, period)
    current_count = increment_counter(key, period)

    # If we've exceeded the limit, raise an error
    if current_count > limit
      raise RateLimitExceeded, "Rate limit exceeded for #{endpoint}: #{current_count}/#{limit} in #{period}s"
    end

    current_count
  end

  # Returns how many requests can still be made in the current time window
  def remaining_requests(endpoint, limit:, period:)
    key = build_key(endpoint, period)
    current_count = @redis.get(key).to_i
    # Ensure we never return negative numbers
    [limit - current_count, 0].max
  end

  # Returns when the current rate limit window will reset
  def reset_time(endpoint, period:)
    key = build_key(endpoint, period)
    # TTL (Time To Live) tells us how many seconds until the key expires
    ttl = @redis.ttl(key)
    ttl > 0 ? Time.current + ttl.seconds : Time.current
  end

  private

  # Builds a Redis key that includes the current time window
  # This creates fixed time buckets (e.g., 12:00:00-12:00:59 for 60s periods)
  def build_key(endpoint, period)
    # Normalize current time to the start of the current window
    # Example: if period=60 and current time is 12:00:45
    # window = (12:00:45 / 60) * 60 = 12:00:00
    window = (Time.current.to_i / period) * period
    "rate_limit:#{endpoint}:#{window}"
  end

  # Atomically increments the counter and sets expiration
  def increment_counter(key, period)
    # Use Redis transaction to ensure atomicity
    @redis.multi do |multi|
      multi.incr(key)      # Increment the counter
      multi.expire(key, period)  # Set key to expire after the period
    end.first  # Return the new counter value
  end
end
```

This rate limiter uses Redis to track request counts in time-bucketed windows. The `check_limit!` method increments the counter and raises an exception if the limit is exceeded.

### Configuring Endpoint Limits

Now let's create a configuration system for our various endpoints:

```ruby
# app/services/api_throttle_config.rb
class ApiThrottleConfig
  ENDPOINT_LIMITS = {
    'payment_api' => {
      'transactions' => { limit: 100, period: 60 },      # 100/minute
      'refunds' => { limit: 20, period: 60 },           # 20/minute
      'reports' => { limit: 5, period: 3600 }           # 5/hour
    },
    'shipping_api' => {
      'rates' => { limit: 50, period: 60 },             # 50/minute
      'tracking' => { limit: 200, period: 60 },         # 200/minute
      'labels' => { limit: 10, period: 60 }             # 10/minute
    }
  }.freeze

  def self.for_endpoint(api_name, endpoint)
    config = ENDPOINT_LIMITS.dig(api_name, endpoint)
    raise ArgumentError, "Unknown endpoint: #{api_name}/#{endpoint}" unless config

    config
  end

  def self.all_endpoints_for(api_name)
    ENDPOINT_LIMITS[api_name] || {}
  end
end
```

This configuration class centralizes all rate limit definitions, making them easy to maintain and update.

## Creating the Throttled HTTP Client

Now let's build an HTTP client that automatically applies throttling:

```ruby
# app/services/throttled_api_client.rb
class ThrottledApiClient
  attr_reader :api_name, :base_url, :rate_limiter

  def initialize(api_name:, base_url:, rate_limiter: ApiRateLimiter.new)
    @api_name = api_name
    @base_url = base_url
    @rate_limiter = rate_limiter
  end

  def get(endpoint, params: {}, headers: {})
    make_request(:get, endpoint, params: params, headers: headers)
  end

  def post(endpoint, body: {}, headers: {})
    make_request(:post, endpoint, body: body, headers: headers)
  end

  private

  def make_request(method, endpoint, **options)
    # Extract endpoint name from path for rate limiting
    endpoint_name = extract_endpoint_name(endpoint)

    # Check rate limit before making request
    check_rate_limit!(endpoint_name)

    # Make the actual HTTP request
    response = execute_request(method, endpoint, **options)

    # Handle rate limit errors from the API
    handle_rate_limit_response(response, endpoint_name)

    response
  rescue ApiRateLimiter::RateLimitExceeded => e
    handle_rate_limit_exceeded(e, endpoint_name)
  end

  def check_rate_limit!(endpoint_name)
    config = ApiThrottleConfig.for_endpoint(api_name, endpoint_name)
    rate_limiter.check_limit!(
      "#{api_name}:#{endpoint_name}",
      limit: config[:limit],
      period: config[:period]
    )
  end

  def execute_request(method, endpoint, **options)
    url = "#{base_url}#{endpoint}"

    case method
    when :get
      HTTParty.get(url, query: options[:params], headers: options[:headers])
    when :post
      HTTParty.post(url, body: options[:body].to_json, headers: default_headers.merge(options[:headers] || {}))
    end
  end

  def handle_rate_limit_response(response, endpoint_name)
    return response unless response.code == 429

    # Log the external rate limit hit
    Rails.logger.warn("External API rate limit hit for #{api_name}/#{endpoint_name}")

    # Update our internal counter to prevent further requests
    config = ApiThrottleConfig.for_endpoint(api_name, endpoint_name)
    rate_limiter.check_limit!(
      "#{api_name}:#{endpoint_name}",
      limit: 0, # Force immediate rate limit
      period: config[:period]
    )

    raise ApiRateLimiter::RateLimitExceeded, "External API rate limit exceeded"
  end

  def handle_rate_limit_exceeded(error, endpoint_name)
    config = ApiThrottleConfig.for_endpoint(api_name, endpoint_name)
    reset_time = rate_limiter.reset_time("#{api_name}:#{endpoint_name}", config[:period])

    Rails.logger.info("Rate limit exceeded for #{api_name}/#{endpoint_name}. Resets at #{reset_time}")

    raise error
  end

  def extract_endpoint_name(path)
    # Extract the main endpoint from the path
    # /api/v1/transactions/123 -> transactions
    path.split('/').find { |segment| segment =~ /^[a-z]+$/ }
  end

  def default_headers
    {
      'Content-Type' => 'application/json',
      'Accept' => 'application/json'
    }
  end
end
```

This client automatically checks rate limits before making requests and handles 429 responses from the external API.

## Adding Retry Logic with Backoff

Let's enhance our client with intelligent retry logic:

```ruby
# app/services/retriable_api_client.rb
class RetriableApiClient < ThrottledApiClient
  MAX_RETRIES = 3
  BASE_DELAY = 1 # second

  private

  def make_request(method, endpoint, **options)
    retries = 0

    begin
      super
    rescue ApiRateLimiter::RateLimitExceeded => e
      if retries < MAX_RETRIES
        retries += 1
        delay = calculate_backoff_delay(retries, endpoint)

        Rails.logger.info("Rate limited. Retry #{retries}/#{MAX_RETRIES} after #{delay}s delay")

        sleep(delay)
        retry
      else
        raise
      end
    end
  end

  def calculate_backoff_delay(retry_count, endpoint)
    endpoint_name = extract_endpoint_name(endpoint)
    config = ApiThrottleConfig.for_endpoint(api_name, endpoint_name)

    # Check how long until rate limit resets
    reset_time = rate_limiter.reset_time("#{api_name}:#{endpoint_name}", config[:period])
    time_until_reset = [reset_time - Time.current, 0].max.to_i

    # Use exponential backoff, but don't wait longer than reset time
    exponential_delay = BASE_DELAY * (2 ** (retry_count - 1))
    [exponential_delay, time_until_reset].min
  end
end
```

This implementation uses exponential backoff but caps the delay at the actual rate limit reset time, avoiding unnecessary waiting.

## Implementing Background Job Throttling

For background jobs, we need a slightly different approach that queues requests when rate limited:

```ruby
# app/jobs/throttled_api_job.rb
class ThrottledApiJob < ApplicationJob
  queue_as :external_api

  def perform(api_name, endpoint, method, **options)
    client = RetriableApiClient.new(
      api_name: api_name,
      base_url: Rails.application.credentials.dig(api_name.to_sym, :base_url)
    )

    response = client.public_send(method, endpoint, **options)

    # Process successful response
    process_response(response)
  rescue ApiRateLimiter::RateLimitExceeded => e
    # Re-enqueue the job with a delay
    retry_job(wait: calculate_retry_delay(api_name, endpoint))
  end

  private

  def calculate_retry_delay(api_name, endpoint_name)
    config = ApiThrottleConfig.for_endpoint(api_name, endpoint_name)
    rate_limiter = ApiRateLimiter.new

    reset_time = rate_limiter.reset_time("#{api_name}:#{endpoint_name}", config[:period])
    [reset_time - Time.current, 5.seconds].max
  end

  def process_response(response)
    # Override in subclasses
    raise NotImplementedError
  end
end
```

This job automatically re-queues itself when rate limited, ensuring eventual processing without blocking other jobs.

## Monitoring and Observability

Let's add monitoring to track our rate limit usage:

```ruby
# app/services/rate_limit_monitor.rb
class RateLimitMonitor
  def self.check_all_limits
    report = {}

    ApiThrottleConfig::ENDPOINT_LIMITS.each do |api_name, endpoints|
      report[api_name] = {}

      endpoints.each do |endpoint, config|
        limiter = ApiRateLimiter.new
        remaining = limiter.remaining_requests(
          "#{api_name}:#{endpoint}",
          limit: config[:limit],
          period: config[:period]
        )

        usage_percentage = ((config[:limit] - remaining) / config[:limit].to_f * 100).round(2)

        report[api_name][endpoint] = {
          limit: config[:limit],
          period: config[:period],
          remaining: remaining,
          usage_percentage: usage_percentage,
          reset_at: limiter.reset_time("#{api_name}:#{endpoint}", config[:period])
        }
      end
    end

    report
  end

  def self.alert_on_high_usage(threshold: 80)
    check_all_limits.each do |api_name, endpoints|
      endpoints.each do |endpoint, stats|
        if stats[:usage_percentage] >= threshold
          Rails.logger.warn(
            "High API usage warning: #{api_name}/#{endpoint} at #{stats[:usage_percentage]}% " \
            "(#{stats[:limit] - stats[:remaining]}/#{stats[:limit]} requests)"
          )

          # Send alert to monitoring service
          # MonitoringService.alert(...)
        end
      end
    end
  end
end

# Add to a scheduled job that runs every minute
class RateLimitMonitorJob < ApplicationJob
  def perform
    RateLimitMonitor.alert_on_high_usage(threshold: 80)
  end
end
```

## Usage Example

Here's how to use the throttled client in your application:

```ruby
# app/services/payment_service.rb
class PaymentService
  def initialize
    @client = RetriableApiClient.new(
      api_name: 'payment_api',
      base_url: 'https://api.payment-provider.com/v1'
    )
  end

  def create_transaction(amount:, customer_id:)
    response = @client.post(
      '/transactions',
      body: {
        amount: amount,
        customer_id: customer_id,
        currency: 'USD'
      }
    )

    handle_response(response)
  rescue ApiRateLimiter::RateLimitExceeded => e
    # Handle rate limiting gracefully
    Rails.logger.error("Cannot create transaction: #{e.message}")
    raise PaymentError, "Payment system is currently busy. Please try again later."
  end

  def process_refund(transaction_id:, amount:)
    response = @client.post(
      '/refunds',
      body: {
        transaction_id: transaction_id,
        amount: amount
      }
    )

    handle_response(response)
  end

  private

  def handle_response(response)
    case response.code
    when 200, 201
      JSON.parse(response.body, symbolize_names: true)
    when 400
      raise PaymentError, "Invalid request: #{response.body}"
    when 401
      raise PaymentError, "Authentication failed"
    else
      raise PaymentError, "Unexpected error: #{response.code}"
    end
  end
end
```

## Testing Your Throttling System

Don't forget to test your rate limiting:

```ruby
# spec/services/api_rate_limiter_spec.rb
RSpec.describe ApiRateLimiter do
  let(:redis) { MockRedis.new }
  let(:limiter) { described_class.new(redis: redis) }

  describe '#check_limit!' do
    it 'allows requests within the limit' do
      10.times do
        expect {
          limiter.check_limit!('test_endpoint', limit: 10, period: 60)
        }.not_to raise_error
      end
    end

    it 'raises error when limit is exceeded' do
      10.times do
        limiter.check_limit!('test_endpoint', limit: 10, period: 60)
      end

      expect {
        limiter.check_limit!('test_endpoint', limit: 10, period: 60)
      }.to raise_error(ApiRateLimiter::RateLimitExceeded)
    end

    it 'resets counter after the period expires' do
      5.times do
        limiter.check_limit!('test_endpoint', limit: 5, period: 2)
      end

      # Simulate time passing
      travel_to(3.seconds.from_now) do
        expect {
          limiter.check_limit!('test_endpoint', limit: 5, period: 2)
        }.not_to raise_error
      end
    end
  end
end
```

## Conclusion

We've built a robust API throttling system that handles multiple endpoints with different rate limits, includes automatic retries, and provides monitoring capabilities. This approach ensures your application respects external API limits while maintaining reliability.

Remember to adjust the configuration values based on your actual API limits and consider implementing circuit breakers for additional resilience.