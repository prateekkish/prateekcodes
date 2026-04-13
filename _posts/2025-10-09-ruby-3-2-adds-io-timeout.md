---
layout: post
title: "Ruby 3.2 Adds IO#timeout for Blocking Operations"
author: prateek
categories: [ Ruby, Ruby 3.2 ]
tags: [ ruby, io, timeout, ruby-3.2, networking ]
excerpt: "Ruby 3.2 introduces IO#timeout to prevent blocking operations from hanging indefinitely, providing a built-in solution for network and file I/O timeouts."
description: "Learn how Ruby 3.2's IO#timeout prevents blocking I/O operations from hanging indefinitely with per-instance timeout control and IO::TimeoutError handling."
keywords: "ruby 3.2, IO timeout, blocking operations, IO::TimeoutError, network timeout, socket timeout, ruby IO, file IO timeout, preventing hanging operations"
---

Network operations and file I/O can block indefinitely, causing applications to hang. Ruby 3.2 introduces `IO#timeout` to set timeouts on individual IO instances, raising `IO::TimeoutError` when operations exceed the specified duration.

## Before Ruby 3.2

Handling timeouts for blocking IO operations required using the `Timeout` module or third-party gems, often with inconsistent implementations:

```ruby
require 'timeout'

# Using Timeout module - can be unsafe
begin
  Timeout.timeout(5) do
    socket = TCPSocket.new('example.com', 80)
    data = socket.read
  end
rescue Timeout::Error
  puts "Operation timed out"
end

# Manual timeout with select - verbose
socket = TCPSocket.new('example.com', 80)
if IO.select([socket], nil, nil, 5)
  data = socket.read
else
  raise "Timeout after 5 seconds"
end
```

The `Timeout` module uses thread interruption, which can leave resources in inconsistent states. Many libraries implemented their own timeout mechanisms, leading to incompatible approaches across the ecosystem.

## Ruby 3.2

`IO#timeout=` sets a timeout duration in seconds for blocking operations on an IO instance. When a blocking operation exceeds this duration, Ruby raises `IO::TimeoutError`:

```ruby
require 'socket'

socket = TCPSocket.new('example.com', 80)
socket.timeout = 5  # 5 seconds

# Raises IO::TimeoutError if read takes longer than 5 seconds
data = socket.read
```

The timeout applies to various blocking operations:

```ruby
# Reading operations
STDIN.timeout = 1
STDIN.gets  # Raises IO::TimeoutError after 1 second
STDIN.read  # Raises IO::TimeoutError after 1 second

# Socket operations
server = TCPServer.new(3000)
server.timeout = 10
client = server.accept  # Raises IO::TimeoutError after 10 seconds

# Writing operations
socket.timeout = 3
socket.write("data")  # Raises IO::TimeoutError after 3 seconds
```

Timeout values can be fractional for sub-second precision:

```ruby
socket.timeout = 0.5  # 500 milliseconds
socket.timeout = 2.5  # 2.5 seconds
```

### Handling Timeout Errors

`IO::TimeoutError` inherits from `IOError`, allowing specific handling:

```ruby
require 'socket'

begin
  socket = TCPSocket.new('api.example.com', 443)
  socket.timeout = 5

  response = socket.read
  process_response(response)
rescue IO::TimeoutError => e
  # Handle timeout specifically
  logger.warn "Request timed out after 5 seconds"
  retry_with_backoff
rescue IOError => e
  # Handle other IO errors
  logger.error "IO error: #{e.message}"
end
```

### Real-World Usage

**HTTP client with timeout:**

```ruby
require 'socket'
require 'openssl'

def fetch_url(host, path, timeout: 10)
  socket = TCPSocket.new(host, 443)
  socket.timeout = timeout

  ssl_socket = OpenSSL::SSL::SSLSocket.new(socket)
  ssl_socket.connect

  ssl_socket.write("GET #{path} HTTP/1.1\r\nHost: #{host}\r\n\r\n")
  response = ssl_socket.read

  ssl_socket.close
  socket.close

  response
rescue IO::TimeoutError
  puts "Request to #{host}#{path} timed out after #{timeout}s"
  nil
end

# Usage
fetch_url('api.github.com', '/users/octocat', timeout: 5)
```

**Background job processing with timeout:**

```ruby
class DataImporter
  def import_from_stream(io, timeout: 30)
    io.timeout = timeout

    line_count = 0
    io.each_line do |line|
      process_line(line)
      line_count += 1
    end

    { success: true, lines: line_count }
  rescue IO::TimeoutError
    { success: false, error: "Import timed out after #{timeout}s", lines: line_count }
  end
end

# Usage with file or network stream
File.open('large_data.csv') do |file|
  importer = DataImporter.new
  result = importer.import_from_stream(file, timeout: 60)
end
```

**Database connection with query timeout:**

```ruby
# Pseudocode for database driver
class DatabaseConnection
  def initialize(host, port, query_timeout: 30)
    @socket = TCPSocket.new(host, port)
    @socket.timeout = query_timeout
  end

  def execute(query)
    @socket.write(query)
    read_response
  rescue IO::TimeoutError => e
    raise DatabaseTimeout, "Query exceeded #{@socket.timeout}s timeout"
  end
end
```

## Implementation Details

`IO#timeout` uses Ruby's internal wait mechanisms (`nogvl_wait_for`, `rb_io_wait`) to implement timeouts, making it more predictable and robust than thread-based approaches. The timeout is a "best effort" mechanism and works most reliably with socket and stream-like IO operations.

Note that `IO#timeout` may not work consistently with all IO types (such as regular files on some systems), as the underlying operating system may not support non-blocking operations for all file types.

## When to Use IO#timeout

- Network operations (HTTP clients, database connections, API calls)
- Socket programming (TCP/UDP servers and clients)
- Reading from stdin or pipes with user interaction
- Background job processing with IO operations
- Any blocking IO where indefinite waiting is unacceptable

## Conclusion

`IO#timeout` provides a standardized, per-instance timeout mechanism for blocking IO operations. By replacing ad-hoc timeout implementations with a consistent API, Ruby 3.2 improves both code reliability and ecosystem compatibility.

## References

- [Feature #18630: Introduce general IO#timeout](https://bugs.ruby-lang.org/issues/18630){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Feature Request 18630 (opens in new tab)"}
- [Pull Request #5653: Add IO#timeout attribute](https://github.com/ruby/ruby/pull/5653){:target="_blank" rel="noopener noreferrer" aria-label="Ruby PR 5653 on GitHub (opens in new tab)"}
- [IO::TimeoutError Documentation](https://docs.ruby-lang.org/en/3.3/IO/TimeoutError.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby IO TimeoutError documentation (opens in new tab)"}
