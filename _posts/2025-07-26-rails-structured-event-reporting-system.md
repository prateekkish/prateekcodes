---
layout: post
title: "Rails is Getting a Structured Event Reporting System (and It's Pretty Cool)"
author: prateek
categories: [ Rails, Upcoming Features, Events ]
tags: [ rails, events, observability, telemetry, logging, instrumentation ]
excerpt: "An upcoming Rails feature will let you emit structured events with context and metadata, solving the messiness of traditional logging while keeping things flexible for different use cases"
description: "Explore Rails' upcoming structured event reporting system that provides unified event emission with contextual metadata, solving limitations of traditional logging while complementing ActiveSupport::Notifications"
keywords: "rails structured events, rails.event, rails observability, rails telemetry, structured logging rails, rails event reporting, activerecord events, rails business events, rails instrumentation"
---

Most Rails developers have moved beyond the default string-based logging with gems like Lograge or Semantic Logger. But when it comes to tracking business events - user signups, order completions, feature usage - we're still building custom solutions or wrestling with tools that weren't designed for this purpose.

Rails is working on something that could change this: a native event reporting system built right into the framework. Instead of cobbling together custom solutions, you'd have a first-class Rails API for emitting structured business events.

## The Current State of Rails Event Tracking

Let me paint you a picture of what we're dealing with today. Most Rails developers have moved beyond the default string-based logging to gems like Lograge, Semantic Logger, or Ougai for structured logs. But when it comes to tracking meaningful business events, you're still juggling multiple approaches:

If you're using something like Lograge, your request logs look clean:

```ruby
# Lograge gives you structured request logs
method=GET path=/orders/123 format=html controller=OrdersController action=show status=200 duration=58.33
```

But that's just request-level data. For business events, you're probably doing something like:

```ruby
Rails.logger.info({ event: "order_created", user_id: user.id, order_id: order.id, total: order.total }.to_json)
# Better than strings, but you're manually building event structures
```

Or maybe you've set up `ActiveSupport::Notifications` for some events:

```ruby
ActiveSupport::Notifications.instrument("order.created", user_id: user.id, total: order.total) do
  # This works, but it's really meant for performance monitoring
  # The payload handling is basic and context management is limited
end
```

The reality is most teams end up building their own event tracking layer:

```ruby
# Every team has some variation of this
class EventTracker
  def self.track(event_name, properties = {})
    Rails.logger.info({
      event: event_name,
      properties: properties,
      timestamp: Time.current,
      request_id: Current.request_id
    }.to_json)
  end
end

EventTracker.track("order_created", {
  user_id: user.id,
  order_id: order.id,
  total: order.total
})
```

It works, but you're maintaining custom event tracking code, manually managing context, and probably duplicating effort across different parts of your app.

## Enter Rails.event: A Native Solution for Business Events

There's a [pull request in progress](https://github.com/rails/rails/pull/55334){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR #55334 on GitHub (opens in new tab)"} that brings event tracking directly into Rails core. It introduces `Rails.event` - a native API that eliminates the need for custom event tracking gems or homegrown solutions.

The beauty of having this built into Rails is consistency: every Rails app would have the same event emission patterns, the same context management, and the same subscriber architecture. No more researching which gem to use or building your own EventTracker class.

### The Basics: Clean, Structured Events

At its core, the API is refreshingly straightforward. Instead of string interpolation hell, you just call `Rails.event.notify` with an event name and a hash of data:

```ruby
# When a user signs up
Rails.event.notify("user.created", {
  id: user.id,
  email: user.email,
  plan: user.plan
})

# When an order is completed
Rails.event.notify("order.completed", {
  order_id: order.id,
  total: order.total,
  payment_method: order.payment_method,
  customer_id: order.customer_id
})
```

Notice how clean this is? You get structured data that any system can consume, whether that's your logging infrastructure, analytics platform, or a custom dashboard.

### Context That Actually Makes Sense

Here's where things get interesting. You know how when you're debugging an issue, you wish you had more context about what was happening when an event occurred? This system lets you add hierarchical context through tags.

Imagine you're building a GraphQL API and want to track everything happening within a request:

```ruby
# Everything inside this block gets tagged with "graphql" and the request ID
Rails.event.tagged("graphql", request_id: SecureRandom.uuid) do
  Rails.event.notify("query.executed", {
    query: query_name,
    duration: 45.2
  })

  # You can nest context too
  Rails.event.tagged("user" => current_user.id) do
    Rails.event.notify("permission.checked", {
      resource: "posts",
      action: "read"
    })
  end
end
```

The clever part is how context inheritance works. It uses fiber-based storage, which means:
- Child processes inherit context from their parents
- You can't accidentally pollute the main thread's context
- It works perfectly with Rails' concurrent request handling

So if you're processing background jobs or handling multiple requests, each gets its own context bubble without interfering with others.

### Beyond Simple Hashes: Custom Event Objects

Sometimes you want more than just throwing a hash at an event. Maybe you have complex business logic around how an event should be structured, or you want to reuse event formatting across different parts of your application.

You can create custom event objects that know how to serialize themselves:

```ruby
class OrderEvent
  def initialize(order)
    @order = order
  end

  def to_h
    {
      order_id: @order.id,
      total: @order.total,
      items_count: @order.items.count,
      customer: {
        id: @order.customer.id,
        tier: @order.customer.tier
      }
    }
  end
end

# Now you can emit the object directly
Rails.event.notify("order.analyzed", OrderEvent.new(order))
```

This is great for complex events where you want to encapsulate the formatting logic. Your subscribers can then call `to_h` on the event object when they need to serialize it for storage or transmission.

## Serialization That Just Works

Now, you might be wondering: "How does this actually get stored or transmitted?" Rails includes built-in encoders for the most common scenarios.

By default, everything gets JSON-encoded, which works great for most logging and analytics systems:

```ruby
# This automatically gets serialized to JSON
Rails.event.notify("user.login", { user_id: 123, ip: request.ip })
```

For high-frequency events, you can configure your subscribers to use MessagePack encoding for better performance:

```ruby
# The event emission stays the same
Rails.event.notify("high_frequency.event", data)

# But your subscriber can use MessagePack for encoding
class HighPerformanceSubscriber
  def emit(event)
    # MessagePack encoding for smaller payloads
    encoded_data = MessagePack.pack(event)
    # Send to your high-throughput system
  end
end
```

MessagePack encoding in subscribers produces smaller payloads and better performance, which matters when tracking thousands of events per second.

## Making Events Actually Useful: Subscribers

Emitting events is only half the story. You need something to actually do something with those events. That's where subscribers come in - they're like event handlers that get called whenever an event is emitted.

Let's say you want all your events to show up in your logs as structured JSON:

```ruby
class LogEventSubscriber
  def emit(event)
    Rails.logger.info({
      event: event[:name],
      payload: event[:payload],
      tags: event[:tags],
      timestamp: Time.at(event[:timestamp] / 1_000_000_000.0),
      context: event[:context]
    }.to_json)
  end
end

# Tell Rails to use this subscriber
Rails.event.subscribe(LogEventSubscriber.new)
```

Now every event gets logged as structured JSON that your log aggregation system can actually parse and query.

But you're not limited to logging. Want to send metrics to StatsD?

```ruby
class MetricsEventSubscriber
  def emit(event)
    StatsD.increment("rails.event.#{event[:name]}")
    # Check if duration is in the payload
    if event[:payload][:duration]
      StatsD.histogram("rails.event.duration", event[:payload][:duration])
    end
  end
end

Rails.event.subscribe(MetricsEventSubscriber.new)
```

You can register multiple subscribers, so the same event can be logged, sent to your metrics system, and forwarded to your analytics platform all at once.

## How This Looks in Real Applications

Enough theory, let's see how this would actually work in a real Rails application.

### E-commerce Controller Events

Imagine you're building an e-commerce site and want to track what's happening in your order creation flow. Instead of scattered logging statements, you could do something like this:

```ruby
class OrdersController < ApplicationController
  def create
    # Tag everything in this action with controller/action context
    Rails.event.tagged("controller" => "orders", "action" => "create") do
      @order = current_user.orders.build(order_params)

      if @order.save
        # Track successful order creation for analytics
        Rails.event.notify("order.created", {
          order_id: @order.id,
          total: @order.total,
          items_count: @order.items.count,
          customer_tier: current_user.tier
        })

        # Signal that this order needs processing
        Rails.event.notify("order.needs_processing", {
          order_id: @order.id,
          priority: @order.priority
        })

        redirect_to @order
      else
        # Track failed attempts (useful for funnel analysis)
        Rails.event.notify("order.creation_failed", {
          errors: @order.errors.full_messages,
          attempted_total: params[:order][:total]
        })

        render :new
      end
    end
  end
end
```

Now you have rich, structured data about your order flow that your analytics team can actually use to build meaningful dashboards and funnels.

### Background Job Tracking

Background jobs are notoriously hard to monitor. You kick them off and hope they work, but when something goes wrong, you're often flying blind. Here's how structured events could change that:

```ruby
class DataProcessingJob < ApplicationJob
  def perform(dataset_id)
    # Tag all events in this job with context
    Rails.event.tagged("job" => self.class.name, "dataset" => dataset_id) do
      Rails.event.notify("job.started", { dataset_id: dataset_id })

      dataset = Dataset.find(dataset_id)

      dataset.records.find_each do |record|
        process_record(record)

        # Track progress for monitoring dashboards
        Rails.event.notify("record.processed", {
          record_id: record.id,
          processing_time: record.processing_duration
        })
      end

      Rails.event.notify("job.completed", {
        dataset_id: dataset_id,
        records_processed: dataset.records.count
      })
    end
  rescue => error
    # Structured error tracking with context
    Rails.event.notify("job.failed", {
      dataset_id: dataset_id,
      error: error.class.name,
      message: error.message
    })
    raise
  end
end
```

Now you can build dashboards showing job success rates, processing times, and failure patterns - all from structured event data instead of trying to parse log files.

## Wait, How Is This Different from ActiveSupport::Notifications?

Good question! Rails already has `ActiveSupport::Notifications`, so why build something new? The short answer is that they're designed for different purposes and work well together.

`ActiveSupport::Notifications` is all about performance monitoring - it tells you how long things take and where your bottlenecks are. It's great for framework-level instrumentation but awkward for business events. `Rails.event`, on the other hand, is purpose-built for tracking what actually happens in your application like user signups, order completions, feature usage, and errors. It has richer context handling, flexible data encoding, and a subscriber system designed for forwarding events to analytics platforms. You'll likely use both: notifications for performance monitoring and events for business intelligence.

## The Current State: Almost There, But Not Quite

Now for the reality check - this feature isn't available yet. The [pull request](https://github.com/rails/rails/pull/55334){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR #55334 on GitHub (opens in new tab)"} is actively being worked on, but there are still some details being hammered out:

**What's definitely happening:**
- ✅ The core `Rails.event.notify` API
- ✅ Fiber-based context with `Rails.event.tagged`
- ✅ Custom event objects that respond to `to_h`
- ✅ Built-in JSON and MessagePack serialization
- ✅ Subscriber system for handling events

**What's still being debated:**
- **Default logging behavior**: Should Rails automatically log events as structured JSON out of the box?
- **Parameter filtering**: How should sensitive data (like passwords) be automatically filtered from events?
- **Performance tuning**: What optimizations are needed for high-throughput applications?

**When will this be available?**
The PR is being actively developed by Adrianna Chang from Shopify with input from Rails core team members. Since it was only opened in July 2025 and represents a significant new feature, it will likely require extensive review and iteration before being merge-ready. Given the typical Rails development cycle, this could potentially land in Rails 8.1 or later, but no timeline has been announced.

## Getting Ready: What You Can Do Now

Even though this feature isn't available yet, you can start thinking about how you'd use it in your applications:

**Look for logging opportunities in your current codebase:**

Next time you write something like this:
```ruby
Rails.logger.info "User signed up: #{user.email}"
```

Think about what structured event this could become:
```ruby
# This will be possible soon
Rails.event.notify("user.signed_up", {
  user_id: user.id,
  email: user.email,
  source: params[:source],
  plan: user.plan
})
```

**Start designing your event schema:**

Instead of ad-hoc logging, think about standardizing your events:
```ruby
# Maybe keep a registry of your event structures
EVENTS = {
  "user.created" => {
    required: [:user_id, :email],
    optional: [:plan, :source, :referrer]
  },
  "order.completed" => {
    required: [:order_id, :total, :customer_id],
    optional: [:discount_applied, :payment_method]
  }
}
```

**Think about your subscriber strategy:**

How would you handle different types of events? Maybe something like:
```ruby
class BusinessEventSubscriber
  def emit(event)
    case event[:name]
    when /^user\./
      # Send user events to your analytics platform
      UserAnalytics.track(event[:name], event[:payload])
    when /^order\./
      # Send order events to your BI system
      OrderAnalytics.track(event[:name], event[:payload])
    when /^error\./
      # Send errors to your monitoring system
      ErrorTracker.report(event[:name], event[:payload], context: event[:tags])
    end
  end
end
```

## Why This Matters More Than You Think

Honestly, I'm pretty excited about this feature. It might seem like "just another logging system," but having this built directly into Rails could fundamentally change how we approach observability.

Right now, every Rails team reinvents event tracking. Some use gems, others build custom solutions, and many just stick with basic logging. There's no standard approach, which means switching between projects often means learning different event systems.

A native Rails event system changes that equation entirely. Imagine if every Rails application had consistent, rich event emission built in from day one. Your error tracking would be better. Your analytics would be more reliable. Your debugging would be way easier. And most importantly, you wouldn't need to research, evaluate, and maintain yet another gem.

Plus, Rails can optimize this at the framework level. The fiber-based context handling is designed to work seamlessly with Rails' concurrency model. The subscriber system integrates naturally with Rails' initialization process. And because it's native, future Rails features can emit events automatically without requiring additional gems.

I suspect once this lands, we'll see a new generation of Rails applications that are observable by design rather than as an afterthought. Having it native to the framework makes observability a default rather than an add-on decision.