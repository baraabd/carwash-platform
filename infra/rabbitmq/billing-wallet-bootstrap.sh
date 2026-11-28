#!/bin/sh
# Dedicated disposable/installation vhost; run with the broker's provisioning
# authority. Application workers receive only their own scoped identity.
set -eu
: "${CW_FINANCE_VHOST:?CW_FINANCE_VHOST is required}"
: "${BILLING_BROKER_PASSWORD:?BILLING_BROKER_PASSWORD is required}"
: "${WALLET_BROKER_PASSWORD:?WALLET_BROKER_PASSWORD is required}"

rabbitmqctl await_startup
rabbitmqctl add_vhost "$CW_FINANCE_VHOST"
rabbitmqctl add_user -- cw_billing_app "$BILLING_BROKER_PASSWORD"
rabbitmqctl add_user -- cw_wallet_app "$WALLET_BROKER_PASSWORD"
rabbitmqctl set_user_tags cw_billing_app
rabbitmqctl set_user_tags cw_wallet_app
# Billing owns its exchange, with no read access to any service queue.
rabbitmqctl set_permissions -p "$CW_FINANCE_VHOST" cw_billing_app \
  '^washgo\.billing\.events$' '^washgo\.billing\.events$' '^$'
# Wallet owns only custody resources. Read on Billing's exchange is necessary
# for binding, never permission to declare it or publish a Billing fact.
rabbitmqctl set_permissions -p "$CW_FINANCE_VHOST" cw_wallet_app \
  '^wallet\.billing-custody(\.|$)' '^wallet\.billing-custody(\.|$)' \
  '^(wallet\.billing-custody(\.|$)|washgo\.billing\.events$)'
# Quorum's default DLX transfer can lose an unavailable target. Retain dead
# letters until their durable target confirms; reject-publish is required by
# RabbitMQ's at-least-once strategy. Applications cannot alter this policy.
rabbitmqctl set_policy --apply-to queues -p "$CW_FINANCE_VHOST" wallet_custody_durable_dlq \
  '^wallet\.billing-custody\.v1$' \
  '{"dead-letter-strategy":"at-least-once","overflow":"reject-publish"}'
echo 'billing and wallet broker identities provisioned'
