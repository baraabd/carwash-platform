#!/bin/sh
# Fresh finance/operations installation profile. The infrastructure authority
# declares the non-Billing producer exchanges before the Reporting worker starts.
# No application identity receives topology-admin credentials or foreign writes.
set -eu
: "${CW_FINANCE_VHOST:?CW_FINANCE_VHOST is required}"
: "${BILLING_BROKER_PASSWORD:?BILLING_BROKER_PASSWORD is required}"
: "${REPORTING_BROKER_PASSWORD:?REPORTING_BROKER_PASSWORD is required}"

rabbitmqctl await_startup
rabbitmqctl add_vhost "$CW_FINANCE_VHOST"
rabbitmqctl add_user cw_billing_app "$BILLING_BROKER_PASSWORD"
rabbitmqctl add_user cw_reporting_app "$REPORTING_BROKER_PASSWORD"
rabbitmqctl set_user_tags cw_billing_app
rabbitmqctl set_user_tags cw_reporting_app
rabbitmqctl set_permissions -p "$CW_FINANCE_VHOST" cw_billing_app \
  '^washgo\.billing\.events$' '^washgo\.billing\.events$' '^$'
rabbitmqctl set_topic_permissions -p "$CW_FINANCE_VHOST" cw_billing_app \
  washgo.billing.events \
  '^billing\.(obligation-created|obligation-status-changed|cash-collected|cash-collection-reversed|custody-handover-changed)\.v1$' '^$'

rabbitmqctl set_permissions -p "$CW_FINANCE_VHOST" cw_reporting_app \
  '^reporting\.operations(\.|$)' '^reporting\.operations(\.|$)' \
  '^(reporting\.operations(\.|$)|washgo\.billing\.events$|booking\.events$|dispatch\.events$|scheduling\.events$|workforce\.events$)'
rabbitmqctl set_topic_permissions -p "$CW_FINANCE_VHOST" cw_reporting_app \
  washgo.billing.events '^$' '^billing\.(obligation-created|obligation-status-changed)\.v1$'
rabbitmqctl set_topic_permissions -p "$CW_FINANCE_VHOST" cw_reporting_app \
  booking.events '^$' '^booking\.(confirmed|created|cancelled|rescheduled|lifecycle-progressed)\.v1$'
rabbitmqctl set_topic_permissions -p "$CW_FINANCE_VHOST" cw_reporting_app \
  dispatch.events '^$' '^dispatch\.(assignment-changed|cash-declared)\.v1$'
rabbitmqctl set_topic_permissions -p "$CW_FINANCE_VHOST" cw_reporting_app \
  scheduling.events '^$' '^scheduling\.hold-changed\.v1$'
rabbitmqctl set_topic_permissions -p "$CW_FINANCE_VHOST" cw_reporting_app \
  workforce.events '^$' '^workforce\.(shift-updated|eligibility-changed)\.v1$'

# Retain rejected facts until the durable dead-letter target confirms them.
rabbitmqctl set_policy --apply-to queues -p "$CW_FINANCE_VHOST" reporting_operations_durable_dlq \
  '^reporting\.operations$' \
  '{"dead-letter-strategy":"at-least-once","overflow":"reject-publish"}'
echo 'billing and reporting broker identities provisioned'
