---
layout: post
title:  "PostgreSQL 17's MERGE with RETURNING: The Game-Changer Rails Developers Have Been Waiting For"
author: prateek
categories: [ Rails, PostgreSQL, Database, Performance ]
excerpt: "PostgreSQL 17 introduces RETURNING support to the MERGE statement, solving a long-standing limitation that forced developers to choose between atomic upserts and knowing what actually happened to their data."
---

PostgreSQL 17 introduces RETURNING support to the MERGE statement ([commit c649fa24a](https://git.postgresql.org/gitweb/?p=postgresql.git;a=commitdiff;h=c649fa24a)), solving a long-standing limitation that forced developers to choose between atomic upserts and knowing what actually happened to their data.

## The Problem

Every Rails application eventually needs to sync data - whether from external APIs, CSV imports, or inter-service communication. The pattern is always the same: insert new records, update existing ones, and track what changed.

```ruby
products_from_api.each do |api_product|
  product = Product.find_or_initialize_by(external_id: api_product[:id])
  was_new_record = product.new_record?
  
  product.update!(
    name: api_product[:name],
    price: api_product[:price]
  )
  
  AuditLog.create!(
    action: was_new_record ? 'created' : 'updated',
    record_id: product.id,
    changes: product.previous_changes
  )
end
```

This approach generates N+1 queries, suffers from race conditions, and requires complex logic to track operations.

## MERGE with RETURNING

PostgreSQL 17's enhancement allows MERGE to return modified rows along with the operation performed:

```sql
MERGE INTO products p
USING (VALUES 
  ('ext_123', 'iPhone 15', 999.99),
  ('ext_124', 'MacBook Pro', 2499.99)
) AS source(external_id, name, price)
ON p.external_id = source.external_id
WHEN MATCHED THEN
  UPDATE SET 
    name = source.name,
    price = source.price,
    updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN
  INSERT (external_id, name, price, created_at, updated_at)
  VALUES (source.external_id, source.name, source.price, 
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING p.*, merge_action() as action;
```

The `merge_action()` function returns 'INSERT', 'UPDATE', or 'DELETE' for each affected row.

## Rails Implementation

Active Record doesn't support MERGE natively. Here's a practical solution:

```ruby
module MergeableRecord
  extend ActiveSupport::Concern

  class_methods do
    def merge_records(records, unique_key: :id, returning: '*')
      return [] if records.empty?

      columns = records.first.keys
      values_list = records.map do |record|
        "(#{columns.map { |col| connection.quote(record[col]) }.join(', ')})"
      end.join(', ')
      
      update_assignments = columns.reject { |col| col == unique_key }.map do |col|
        "#{col} = source.#{col}"
      end
      update_assignments << "updated_at = CURRENT_TIMESTAMP"
      
      sql = <<-SQL
        MERGE INTO #{table_name} AS target
        USING (VALUES #{values_list}) AS source(#{columns.join(', ')})
        ON target.#{unique_key} = source.#{unique_key}
        WHEN MATCHED THEN
          UPDATE SET #{update_assignments.join(', ')}
        WHEN NOT MATCHED THEN
          INSERT (#{columns.join(', ')}, created_at, updated_at)
          VALUES (#{columns.map { |c| "source.#{c}" }.join(', ')}, 
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING #{returning}, merge_action() as merge_action
      SQL
      
      result = connection.exec_query(sql)
      result.map { |row| row.symbolize_keys }
    end
  end
end
```

### Usage

```ruby
class Product < ApplicationRecord
  include MergeableRecord
end

results = Product.merge_records(
  [
    { external_id: 'ext_123', name: 'iPhone 15', price: 999.99 },
    { external_id: 'ext_124', name: 'MacBook Pro', price: 2499.99 }
  ],
  unique_key: :external_id
)

# results:
# [
#   { id: 1, external_id: 'ext_123', name: 'iPhone 15', price: 999.99, merge_action: 'UPDATE' },
#   { id: 2, external_id: 'ext_124', name: 'MacBook Pro', price: 2499.99, merge_action: 'INSERT' }
# ]
```

## Performance Comparison

Syncing 10,000 products:

**Traditional approach (find_or_create_by):**
- 20,000+ queries
- 45 seconds
- Race condition prone

**MERGE with RETURNING:**
- 100 queries (batched)
- 3 seconds
- Atomic operations

## Practical Applications

### Audit Logging

```ruby
results = Product.merge_records(products_data, unique_key: :sku)

audit_logs = results.map do |result|
  {
    record_type: 'Product',
    record_id: result[:id],
    action: result[:merge_action].downcase,
    performed_at: Time.current
  }
end

AuditLog.insert_all(audit_logs)
```

### Cache Invalidation

```ruby
results = Product.merge_records(updated_products, unique_key: :sku)

results.select { |r| r[:merge_action] == 'UPDATE' }.each do |result|
  Rails.cache.delete("product/#{result[:id]}")
end
```

### Conflict Resolution

```ruby
MERGE INTO inventory i
USING new_inventory n ON i.sku = n.sku
WHEN MATCHED AND i.updated_at < n.updated_at THEN
  UPDATE SET quantity = n.quantity, updated_at = n.updated_at
WHEN NOT MATCHED THEN
  INSERT VALUES (n.sku, n.quantity, n.updated_at)
RETURNING i.*, merge_action() as action;
```

## Limitations

- Requires PostgreSQL 17+
- No Active Record native support
- Complex MERGE conditions can impact performance
- Limited to single-table operations

## Conclusion

PostgreSQL 17's MERGE with RETURNING eliminates the need for multiple queries and race-prone code when handling upserts. While Active Record support is pending, the patterns shown here provide immediate access to this powerful feature.

For data synchronization, ETL processes, and any scenario requiring bulk upserts with operation tracking, MERGE with RETURNING transforms complex multi-query operations into single, atomic statements.