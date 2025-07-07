---
layout: post
title: "Rails Blue-Green Deployments: How Database Migrations Work in Production"
author: prateek
categories: [ Rails, DevOps, AWS, PostgreSQL ]
tags: [ rails, deployments, migrations, zero-downtime, aws-codedeploy, ecs, blue-green ]
excerpt: "A deep dive into how Rails applications achieve true zero-downtime deployments with database migrations using AWS CodeDeploy and ECS."
description: "Learn how production Rails applications implement blue-green deployments with database migrations. Real-world patterns using AWS CodeDeploy, ECS, and migration-first deployment strategies."
keywords: "rails blue green deployment, aws codedeploy rails, ecs database migrations, zero downtime rails deployment, rails migration strategies, aws blue green deployment, how to run rails migrations without downtime, rails deployment with database migrations aws, blue green deployment database migration strategy, rails concurrent index creation production, rails migration rollback strategy production, aws ecs run migration task, rails idempotent migrations example, rails multi service deployment coordination, postgresql concurrent index rails migration, rails materialized view migration pattern, terraform blue green deployment configuration, rails migration timeout configuration, how to handle failed migrations in production, rails deployment pipeline with migrations"
---

{% include mermaid.html %}

Running database migrations during a blue-green deployment is the trickiest part of achieving zero downtime. While AWS CodeDeploy handles the traffic switching beautifully, your shared database becomes the critical coordination point between old and new code.

## The Migration-First Deployment Strategy

In a production blue-green deployment, migrations run as a separate step before any application code is deployed. This ensures your database schema is ready for the new code while remaining compatible with the currently running version.

<div class="mermaid">
graph TB
    subgraph "Phase 1: Migration"
        A[GitHub Actions] --> B[ECS Migration Task]
        B --> C[(Shared RDS Database)]
        C --> D{Migration Success?}
        D -->|Yes| E[Continue to Deploy]
        D -->|No| F[❌ Stop Pipeline]
    end

    subgraph "Phase 2: Blue-Green Deployment"
        E --> G[Deploy to Green Environment]

        subgraph "Load Balancer"
            H[100% Traffic] --> I[Blue Environment<br/>Old Code]
            I -.-> C
        end

        G --> J[Green Environment<br/>New Code]
        J -.-> C

        G --> K{Health Checks Pass?}
        K -->|Yes| L[Switch Traffic]
        K -->|No| M[❌ Keep Blue Active]

        L --> N[100% Traffic to Green]
        N --> O[Terminate Blue<br/>after 5 minutes]
    end

    style C fill:#f9f,stroke:#333,stroke-width:4px
    style I fill:#bbf,stroke:#333,stroke-width:2px
    style J fill:#bfb,stroke:#333,stroke-width:2px
</div>

Here's how it works in practice with AWS ECS and CodeDeploy:

```yaml
# GitHub Actions workflow
jobs:
  build:
    # Build and push Docker image to ECR

  database-migration:
    needs: build
    steps:
      - name: Run database migration
        uses: aws-actions/amazon-ecs-run-task@v1
        with:
          cluster: production-cluster
          task-definition: app-task-definition
          subnet-ids: ${{ vars.PRIVATE_SUBNET }}
          security-group-ids: ${{ vars.APP_SECURITY_GROUP }}
          override-container-command: |
            bundle exec rake db:migrate --trace
          wait-for-task-stopped: true

  deploy-application:
    needs: [build, database-migration]  # Only deploy after migrations succeed
    # Blue-green deployment via CodeDeploy
```

## ECS Task Execution for Migrations

Running migrations as a one-off ECS task provides isolation and proper error handling. Configure your deployment pipeline to:

1. **Launch a dedicated ECS task** using your application's task definition
2. **Override the command** to run `bundle exec rake db:migrate` instead of starting the web server
3. **Wait for completion** and check the exit code before proceeding
4. **Fail the deployment** if migrations don't complete successfully

This approach ensures:
- Migrations use the same Docker image and environment as your application
- Database changes are isolated from serving traffic
- Clear success/failure signals prevent deploying incompatible code
- Logs are captured in your standard monitoring tools

## Handling Statement Timeouts

Production Rails apps need careful timeout management during migrations:

```ruby
# config/database.yml
production:
  adapter: postgresql
  variables:
    statement_timeout: <%= ENV["PG_STATEMENT_TIMEOUT"] || "30000" %>

# During migration, override the timeout
docker exec -e PG_STATEMENT_TIMEOUT='0' app bundle exec rake db:migrate
```

For specific long-running migrations:

```ruby
class CreateReportingView < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  def up
    execute "SET statement_timeout = '30min'"

    execute <<~SQL
      CREATE MATERIALIZED VIEW monthly_reports AS
      SELECT ...
    SQL

    # Create indexes concurrently to avoid blocking
    add_index :monthly_reports, :account_id,
      algorithm: :concurrently,
      if_not_exists: true

    execute "SET statement_timeout = '30s'"
  end
end
```

## Blue-Green Traffic Switching

Once migrations complete, AWS CodeDeploy orchestrates the blue-green deployment. The infrastructure setup requires two identical target groups (blue and green) behind an Application Load Balancer. CodeDeploy manages the traffic switching between these groups, allowing for instant rollback if issues arise.

The Terraform configuration sets up:
- **Target groups** with health checks to ensure only healthy instances receive traffic
- **Deregistration delay** to allow existing connections to complete gracefully
- **Deployment configuration** that controls how long to keep the old environment running

```hcl
# Terraform configuration
resource "aws_lb_target_group" "blue" {
  port                 = 3000
  protocol            = "HTTP"
  vpc_id              = var.vpc_id
  target_type         = "ip"
  deregistration_delay = 60

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 5
    interval            = 30
  }
}

resource "aws_lb_target_group" "green" {
  # Identical configuration
}

resource "aws_codedeploy_deployment_group" "app" {
  deployment_config_name = "CodeDeployDefault.ECSAllAtOnce"

  blue_green_deployment_config {
    terminate_blue_instances_on_deployment_success {
      action                                = "TERMINATE"
      termination_wait_time_in_minutes      = 5
    }

    deployment_ready_option {
      action_on_timeout = "CONTINUE_DEPLOYMENT"
    }
  }
}
```

## Real-World Migration Patterns

Let's examine common migration scenarios that require special handling in production. These patterns ensure your database remains available while schema changes are applied, even on tables with millions of rows.

### Concurrent Index Creation

Always create indexes concurrently in production:

```ruby
class AddIndexOnOrders < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  def change
    add_index :orders,
      :customer_id,
      algorithm: :concurrently,
      if_not_exists: true
  end
end
```

### Idempotent Migrations

Make migrations safe to run multiple times:

```ruby
class AddLocationIdToProducts < ActiveRecord::Migration[8.0]
  def up
    unless column_exists?(:products, :location_id)
      add_column :products, :location_id, :bigint
    end

    add_index :products, :location_id,
      algorithm: :concurrently,
      if_not_exists: true
  end
end
```

### Managing Materialized Views

For complex reporting queries, use materialized views with proper refresh strategies:

```ruby
# Rake task for view refresh
namespace :views do
  task refresh_reports: :environment do
    ActiveRecord::Base.connection.execute(
      "REFRESH MATERIALIZED VIEW CONCURRENTLY sales_summary"
    )
  end
end

# Run via cron or after deployments
```

## Multi-Service Coordination

When deploying multiple services, ensure proper ordering:

```yaml
deploy-web:
  needs: [build, database-migration]

deploy-worker:
  needs: [build, database-migration]
  # Workers get graceful shutdown signal

deploy-queue-processor:
  needs: [build, database-migration]
  # Queue processors also wait for migrations
```

All services wait for migrations to complete, preventing version mismatches.

## Production Best Practices

1. **Always disable DDL transactions** for index operations
2. **Set appropriate timeouts** for different migration types
3. **Use concurrent operations** to avoid locking
4. **Make migrations idempotent** for safety
5. **Test rollback procedures** in staging first
6. **Monitor migration duration** and set alerts
7. **Keep migrations small** - one concern per migration

## When Things Go Wrong

Despite best practices, issues can occur:

- **Partial migration failure**: Design migrations to be resumable
- **Timeout during migration**: Increase timeout for specific operations
- **Lock contention**: Use `lock_timeout` to fail fast instead of blocking
- **Rollback needed**: Ensure down methods work correctly

## Conclusion

Blue-green deployments with Rails require treating database migrations as a first-class deployment step. By running migrations in isolated ECS tasks before deploying application code, you maintain compatibility while achieving true zero downtime. The combination of AWS CodeDeploy for traffic management and careful migration practices delivers reliable, stress-free deployments.

## References

- [AWS CodeDeploy Blue/Green Deployments](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-groups-create-blue-green.html){:target="_blank" rel="noopener noreferrer" aria-label="AWS CodeDeploy blue/green deployment documentation (opens in new tab)"}
- [PostgreSQL Concurrent Indexes](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL concurrent index documentation (opens in new tab)"}
- [Rails Active Record Migrations Guide](https://guides.rubyonrails.org/active_record_migrations.html){:target="_blank" rel="noopener noreferrer" aria-label="Rails Active Record Migrations guide (opens in new tab)"}