---
layout: post
title: "Ruby 3.4's Happy Eyeballs v2: Solving Rails API Timeout Hell"
author: prateek
categories: [ Ruby, Rails, Performance ]
tags: [ ruby, rails, networking, performance, api ]
excerpt: "Ruby 3.4 introduces Happy Eyeballs v2, dramatically reducing connection delays for external API calls in Rails applications"
description: "Learn how Ruby 3.4's Happy Eyeballs v2 implementation solves connection timeout issues for Rails apps making external API calls. Practical examples and benchmarks included."
keywords: "ruby 3.4, happy eyeballs, rails api timeout, network performance, ipv6, ipv4, connection optimization"
---

Your Rails app makes an API call to a payment gateway. The request hangs for 30 seconds before timing out. Sound familiar? Ruby 3.4's Happy Eyeballs v2 implementation fixes this exact problem.

## The Dual-Stack Connection Problem

Modern servers often have both IPv6 and IPv4 addresses. When your Rails app connects to these servers, it faces a dilemma: which address should it try first?

```ruby
# Your typical Rails service
class PaymentService
  def process_payment(amount)
    # This could hang for 30+ seconds if IPv6 is broken
    response = Net::HTTP.get_response(URI('https://api.stripe.com/v1/charges'))
  end
end
```

Here's what happens behind the scenes:

1. **Serial DNS Resolution**: Ruby queries for IPv6 address, waits for response, then queries for IPv4
2. **Serial Connection Attempts**: Tries IPv6 first, waits for full timeout if it fails, then tries IPv4

The killer scenario: Your server's IPv6 is misconfigured. Ruby tries IPv6 first, waits 30 seconds for timeout, then finally tries IPv4 which works instantly. Your users just waited 30 seconds for something that could have taken 300ms.

## Ruby 3.4's Happy Eyeballs Solution

Ruby 3.4 implements [Happy Eyeballs Version 2 (RFC 8305)](https://www.rfc-editor.org/rfc/rfc8305){:target="_blank" rel="noopener noreferrer"}, a clever algorithm that races connections instead of waiting:

```ruby
# Ruby 3.4 - Automatic parallel connections
require 'socket'

# This now attempts IPv4 and IPv6 intelligently
socket = TCPSocket.new('api.stripe.com', 443)

# Or using Socket.tcp with explicit control
socket = Socket.tcp('api.stripe.com', 443, fast_fallback: true)
```

Here's how Happy Eyeballs works:

1. **Parallel DNS Queries**: Asks for both IPv6 and IPv4 addresses simultaneously
2. **Smart Racing**: Starts IPv6 connection first (it's the future!)
3. **Quick Fallback**: After 250ms, starts IPv4 connection in parallel
4. **Winner Takes All**: Uses whichever connects first, cancels the other

The pitch: If IPv6 is broken, you only wait 250ms before trying IPv4, not 30 seconds!

## Real-World Performance Impact

Let's see Happy Eyeballs in action with a service that has broken IPv6:

```ruby
require 'benchmark'
require 'socket'

# Simulate connecting to a service with broken IPv6
host = 'api.payment-gateway.com'
port = 443

# Ruby 3.3 - Serial approach
def old_way_connect(host, port)
  # Try IPv6 first, wait for full timeout
  # Then try IPv4
  TCPSocket.new(host, port)
end

# Ruby 3.4 - Happy Eyeballs approach
def happy_eyeballs_connect(host, port)
  # Races IPv6 and IPv4 connections
  Socket.tcp(host, port, fast_fallback: true)
end

# When IPv6 is broken:
# Ruby 3.3: Waits 30+ seconds for IPv6 timeout
# Ruby 3.4: Connects via IPv4 in ~250ms
```

The difference is dramatic. What previously caused 30-second timeouts now completes in milliseconds.

## Rails Applications Benefit Automatically

Your Rails app gets this improvement automatically. Since Net::HTTP uses TCPSocket internally, any code using Net::HTTP benefits from Happy Eyeballs v2 by default:

```ruby
# Net::HTTP gets Happy Eyeballs v2 automatically
Net::HTTP.get(URI('https://api.github.com/users'))

# This also works with any library built on Net::HTTP
response = Net::HTTP.get_response(URI('https://api.stripe.com/v1/charges'))
```

## Understanding the Magic

Let's visualize the chronology to understand what Happy Eyeballs actually does:

```ruby
# The problem visualized
def connect_without_happy_eyeballs
  # Step 1: Ask DNS for IPv6 address... wait...
  # Step 2: Ask DNS for IPv4 address... wait...
  # Step 3: Try IPv6 connection... wait 30 seconds... timeout!
  # Step 4: Try IPv4 connection... instant success!
  # Total time: 30+ seconds
end

def connect_with_happy_eyeballs
  # Step 1: Ask DNS for both addresses simultaneously
  # Step 2: Start IPv6 connection
  # Step 3: After 250ms, start IPv4 connection too
  # Step 4: IPv4 connects first? Use it!
  # Total time: ~300ms
end
```

The algorithm respects IPv6 preference while being pragmatic about real-world network issues.

## Performance Considerations

While Happy Eyeballs prevents catastrophic timeouts, it does add some overhead:

```ruby
# Disable Happy Eyeballs if you need absolute minimum latency
# and know your network is reliable
socket = Socket.tcp('internal.service', 3000, fast_fallback: false)

# Or set the environment variable
ENV['RUBY_TCP_NO_FAST_FALLBACK'] = '1'
```

For most applications, the protection against timeouts far outweighs the minimal overhead.

## Conclusion

Ruby 3.4's Happy Eyeballs v2 turns 30-second timeouts into 300ms connections. No code changes needed - your Rails apps get faster automatically.

**References:**
- [Ruby 3.4.0 Release Notes](https://www.ruby-lang.org/en/news/2024/12/25/ruby-3-4-0-released/){:target="_blank" rel="noopener noreferrer"}
- [Happy Eyeballs Implementation PR](https://github.com/ruby/ruby/pull/9374){:target="_blank" rel="noopener noreferrer"}
- [RFC 8305 Specification](https://www.rfc-editor.org/rfc/rfc8305){:target="_blank" rel="noopener noreferrer"}
- [RubyKaigi 2024: An Adventure of Happy Eyeballs](https://www.youtube.com/watch?v=HU-kfUxM2lc){:target="_blank" rel="noopener noreferrer"}