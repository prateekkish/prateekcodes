---
layout: post
title: "Rails 8.2 adds this_week?, this_month?, and this_year? to Date and Time"
author: prateek
categories: [ Rails, Rails 8.2, ActiveSupport ]
tags: [ rails-8-2, activesupport, date, time, predicates ]
excerpt: "Rails 8.2 introduces this_week?, this_month?, and this_year? to Date and Time, joining today?, yesterday?, and tomorrow? as readable predicate methods for common date range checks."
description: "Rails 8.2 adds this_week?, this_month?, and this_year? to ActiveSupport's Date and Time classes, replacing verbose range comparisons with clean, readable one-liners."
keywords: "Rails 8.2 this_week?, this_month?, this_year?, ActiveSupport date predicates, Rails date helpers, Date this_week Rails, Rails 8.2 date methods"
---

ActiveSupport already has `today?`, `yesterday?`, and `tomorrow?` on `Date` and `Time`. Rails 8.2 adds the next logical set: `this_week?`, `this_month?`, and `this_year?`.

## Before

Checking whether a date falls within the current week, month, or year required range comparisons:

```ruby
# Is this order from the current week?
order.placed_at.between?(Time.current.beginning_of_week, Time.current.end_of_week)

# Is this subscription expiring this month?
subscription.expires_on.between?(Date.current.beginning_of_month, Date.current.end_of_month)

# Is this event happening this year?
event.date.year == Date.current.year
```

Each check is readable enough on its own, but they add up quickly in controllers and views where you are branching on date ranges.

## Rails 8.2

[PR #55770](https://github.com/rails/rails/pull/55770){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR 55770 adding this_week? this_month? this_year? (opens in new tab)"} introduces three new predicate methods on `Date` and `Time`:

```ruby
order.placed_at.this_week?           # true if within the current week
subscription.expires_on.this_month?  # true if within the current month
event.date.this_year?                # true if within the current year
```

They follow the same pattern as the existing predicates:

```ruby
Date.current.this_week?   # => true
Date.current.this_month?  # => true
Date.current.this_year?   # => true

Date.yesterday.this_week? # => true (yesterday is still this week, usually)
Date.current.next_month.this_month? # => false
```

### In controllers

```ruby
def index
  @orders = Order.all
  @this_week_orders = @orders.select { |o| o.placed_at.this_week? }
  @this_month_orders = @orders.select { |o| o.placed_at.this_month? }
end
```

### In views

```erb
<% if subscription.expires_on.this_month? %>
  <div class="warning">Your subscription expires this month.</div>
<% end %>

<% if report.generated_at.this_week? %>
  <span class="badge">Recent</span>
<% end %>
```

### In scopes

```ruby
class Order < ApplicationRecord
  scope :placed_this_week, -> { where(placed_at: Time.current.beginning_of_week..Time.current.end_of_week) }
  scope :placed_this_month, -> { where(placed_at: Time.current.beginning_of_month..Time.current.end_of_month) }
end
```

The predicate methods on instances complement these scopes when working with already-loaded records.

## How to change the week boundary

`this_week?` uses Monday as the start of the week by default, consistent with ActiveSupport's `beginning_of_week`. If your application configures a different week start, that is respected:

```ruby
Date.beginning_of_week = :sunday
Date.current.beginning_of_week  # => last Sunday
```

## Conclusion

`this_week?`, `this_month?`, and `this_year?` are small additions that remove a common category of boilerplate. They complete the set of readable date predicates that ActiveSupport has offered since Rails 3.

## References

- [Pull Request #55770](https://github.com/rails/rails/pull/55770){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR 55770 adding this_week? this_month? this_year? (opens in new tab)"}
- [ActiveSupport Date Calculations documentation](https://api.rubyonrails.org/classes/ActiveSupport/CoreExt/Date/Calculations.html){:target="_blank" rel="noopener noreferrer" aria-label="ActiveSupport Date Calculations documentation (opens in new tab)"}
