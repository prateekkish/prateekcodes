---
layout: post
title: "Ruby::Box Practical Guide: Use Cases and Integration Patterns (Part 2)"
author: prateek
categories: [ Ruby, Ruby 4.0, Isolation ]
tags: [ ruby, ruby-box, namespace, isolation, plugins, multi-tenant, ruby-4 ]
excerpt: "Practical patterns for using `Ruby::Box` in plugin systems, multi-tenant applications, and gem version migration scenarios."
description: "Learn practical `Ruby::Box` patterns including plugin isolation, multi-tenant configurations, running multiple gem versions, and handling known limitations."
keywords: "ruby box tutorial, ruby box examples, plugin isolation ruby, multi-tenant ruby, gem version conflicts, ruby namespace patterns, ruby 4 practical guide"
---

In [Part 1](/ruby-4-introduces-ruby-box-for-in-process-isolation-part-1/), we covered what `Ruby::Box` is and how it provides namespace isolation. Now let's explore practical patterns for integrating it into real applications.

## Use Case: Plugin Systems

Plugin systems benefit significantly from `Ruby::Box`. Each plugin runs in its own isolated environment, preventing plugins from interfering with each other or the host application.

```ruby
class PluginManager
  def initialize
    @plugins = {}
  end

  def load_plugin(name, path)
    box = Ruby::Box.new
    box.require(path)

    # Access the plugin class from within the box
    plugin_class = box.eval('Plugin')
    @plugins[name] = {
      box: box,
      instance: plugin_class.new
    }
  end

  def run(name, method, *args)
    plugin = @plugins[name]
    plugin[:instance].public_send(method, *args)
  end

  def unload(name)
    @plugins.delete(name)
    # Box becomes eligible for garbage collection
  end
end

# Usage
manager = PluginManager.new
manager.load_plugin(:markdown, './plugins/markdown_plugin')
manager.load_plugin(:syntax_highlight, './plugins/syntax_plugin')

# Each plugin has its own isolated environment
# If markdown_plugin patches String, syntax_plugin won't see it
manager.run(:markdown, :process, content)
```

This pattern ensures that a misbehaving plugin cannot corrupt the global namespace or break other plugins.

## Use Case: Multi-Tenant Configuration

Applications serving multiple tenants often need per-tenant configurations. `Ruby::Box` provides clean isolation without complex scoping logic.

```ruby
class TenantContext
  def initialize(tenant_id, config_path)
    @tenant_id = tenant_id
    @box = Ruby::Box.new
    @box.require(config_path)
  end

  def config
    @box.eval('TenantConfig')
  end

  def execute(code)
    @box.eval(code)
  end
end

# Each tenant gets isolated configuration
tenant_a = TenantContext.new('acme', './tenants/acme/config')
tenant_b = TenantContext.new('globex', './tenants/globex/config')

tenant_a.config.theme      # => "dark"
tenant_b.config.theme      # => "light"

# Global variables are isolated too
tenant_a.execute('$rate_limit = 100')
tenant_b.execute('$rate_limit = 500')

tenant_a.execute('$rate_limit')  # => 100
tenant_b.execute('$rate_limit')  # => 500
```

## Use Case: Running Multiple Gem Versions

During migrations, you might need to run two versions of the same gem simultaneously. `Ruby::Box` makes this possible without separate processes.

```ruby
# Load v1 API client in one box
v1_box = Ruby::Box.new
v1_box.eval <<~RUBY
  $LOAD_PATH.unshift('./vendor/api_client_v1/lib')
  require 'api_client'
RUBY

# Load v2 API client in another box
v2_box = Ruby::Box.new
v2_box.eval <<~RUBY
  $LOAD_PATH.unshift('./vendor/api_client_v2/lib')
  require 'api_client'
RUBY

# Compare behavior during migration
def compare_responses(endpoint, params)
  code = "ApiClient.get('#{endpoint}', #{params.inspect})"
  v1_response = v1_box.eval(code)
  v2_response = v2_box.eval(code)

  if v1_response != v2_response
    log_difference(endpoint, v1_response, v2_response)
  end

  v1_response  # Return v1 for now, switch to v2 when ready
end
```

## Use Case: Isolated Monkey Patches for Testing

Some tests require monkey patches that would pollute the global namespace. `Ruby::Box` keeps these contained.

```ruby
# test_helper.rb
def create_time_frozen_box(frozen_time)
  box = Ruby::Box.new
  box.eval <<~RUBY
    class Time
      def self.now
        Time.new(#{frozen_time.year}, #{frozen_time.month}, #{frozen_time.day})
      end
    end
  RUBY
  box
end

# In your test
def test_subscription_expiry
  box = create_time_frozen_box(Time.new(2026, 1, 1))

  # Load and test code within the frozen-time box
  box.eval <<~RUBY
    expiry_date = Time.new(2025, 12, 31)
    subscription = Subscription.new(expires_at: expiry_date)
    raise "Expected expired" unless subscription.expired?
  RUBY

  # Time.now is unchanged outside the box
  Time.now  # => Current actual time
end
```

## Use Case: Shadow Testing

Run new code paths alongside production code to compare results without affecting users. This pattern is useful for validating refactors or new implementations.

```ruby
class ShadowRunner
  def initialize(production_box, shadow_box)
    @production = production_box
    @shadow = shadow_box
  end

  def run(method, *args)
    code = "#{method}(#{args.map(&:inspect).join(', ')})"

    # Production path returns the result
    production_result = @production.eval(code)

    # Shadow path runs asynchronously, logs differences
    Thread.new do
      shadow_result = @shadow.eval(code)

      unless production_result == shadow_result
        Logger.warn("Shadow mismatch for #{method}",
          production: production_result,
          shadow: shadow_result
        )
      end
    end

    production_result
  end
end
```

## Working Around Native Extension Issues

Native extensions may fail to install with `RUBY_BOX=1` enabled. The solution is to separate installation from execution:

```bash
# Gemfile installation without Boxing
bundle install

# Application execution with Boxing
RUBY_BOX=1 bundle exec ruby app.rb
```

For CI/CD pipelines:

```yaml
# .github/workflows/test.yml
jobs:
  test:
    steps:
      - name: Install dependencies
        run: bundle install

      - name: Run tests with Ruby::Box
        run: RUBY_BOX=1 bundle exec rspec
        env:
          RUBY_BOX: "1"
```

## Working Around ActiveSupport Issues

Some ActiveSupport core extensions have compatibility issues. Load them in your main context before creating boxes:

```ruby
# At application startup, before creating any boxes
require 'active_support/core_ext/string/inflections'
require 'active_support/core_ext/hash/keys'

# Now create boxes for isolated code
plugin_box = Ruby::Box.new
# Plugins can use the already-loaded extensions
```

Alternatively, selectively load only what you need inside boxes:

```ruby
box = Ruby::Box.new
box.eval <<~RUBY
  # Load specific extensions that are known to work
  require 'active_support/core_ext/object/blank'
RUBY
```

## Performance Considerations

`Ruby::Box` adds minimal overhead for most operations:

- **Method dispatch**: Slightly more indirection through separate method tables
- **Object creation**: Unaffected, objects pass freely between boxes
- **Memory**: Each box maintains its own class/module definitions

For performance-critical paths, cache class references:

```ruby
class OptimizedPluginRunner
  def initialize(box)
    @box = box
    # Cache the class reference once
    @processor_class = box.eval('DataProcessor')
  end

  def process(data)
    # Use cached reference instead of evaluating each time
    @processor_class.new.process(data)
  end
end
```

## When to Use `Ruby::Box`

**Good candidates:**

- Plugin or extension systems where isolation is critical
- Multi-tenant applications with per-tenant customizations
- Testing scenarios requiring invasive monkey patches
- Gradual migration between gem versions
- Applications loading third-party code that might conflict

**Poor candidates:**

- Running untrusted or potentially malicious code (use OS-level sandboxing)
- Production systems until the feature stabilizes
- Applications heavily dependent on native extensions
- Simple applications without isolation requirements

## Migration Strategy

If you're considering `Ruby::Box` for an existing application:

**Step 1: Test compatibility**

```bash
# Run your test suite with Boxing enabled
RUBY_BOX=1 bundle exec rspec
```

**Step 2: Identify issues**

Look for failures related to:
- Shared global state across files
- Assumptions about class modifications being visible everywhere
- Native extension loading errors

**Step 3: Refactor incrementally**

Start with isolated subsystems that don't share state with the rest of your application. Move more code into boxes as you gain confidence.

**Step 4: Monitor in staging**

Run your staging environment with `RUBY_BOX=1` before considering production deployment.

## What's Next for `Ruby::Box`

The Ruby core team has discussed building a higher-level "packages" API on top of `Ruby::Box`. This would provide more ergonomic ways to manage gem isolation without manual box management. Track progress in [Ruby Issue #21681](https://bugs.ruby-lang.org/issues/21681){:target="_blank" rel="noopener noreferrer" aria-label="Ruby packages feature discussion (opens in new tab)"}.

`Ruby::Box` solves real problems around namespace pollution and gem conflicts. While still experimental, it's worth exploring for applications where isolation matters. Start with non-critical paths, understand the limitations, and provide feedback to the Ruby core team as you experiment.

## References

- [Ruby::Box Official Documentation](https://docs.ruby-lang.org/en/master/Ruby/Box.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby::Box official documentation (opens in new tab)"}
- [Ruby::Box Shadow Execution Example](https://github.com/geeknees/ruby_box_shadow_universe){:target="_blank" rel="noopener noreferrer" aria-label="Ruby::Box shadow execution example repository (opens in new tab)"}
- [RubyKaigi 2025: State of Namespace](https://rubykaigi.org/2025/presentations/tagomoris.html){:target="_blank" rel="noopener noreferrer" aria-label="State of Namespace presentation at RubyKaigi 2025 (opens in new tab)"}
- [Ruby Issue #21681: Packages API](https://bugs.ruby-lang.org/issues/21681){:target="_blank" rel="noopener noreferrer" aria-label="Ruby packages feature discussion (opens in new tab)"}
