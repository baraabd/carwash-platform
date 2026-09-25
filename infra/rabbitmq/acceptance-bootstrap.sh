#!/bin/sh
# Provisions least-privilege RabbitMQ identities for the acceptance run.
# Executed INSIDE the acceptance rabbitmq container.
#
# Identity model:
#   cw_infra_topology    infrastructure identity; declares exchanges/queues/bindings.
#                        Scoped to the acceptance vhost and given NO administrator tag,
#                        so even it cannot administer the broker.
#   cw_catalog_app       producer; may declare and publish to its OWN exchange only.
#   cw_communications_app
#   cw_reporting_app     subscribers; may own their OWN namespace and READ the catalog
#                        exchange in order to bind, nothing else.
#
# Consequences that the ACL tests assert:
#   - a producer cannot consume another service's queue
#   - a subscriber cannot publish to the producer's exchange
#   - nobody can publish through the default exchange (amq.default)
#   - nobody can create resources outside their own namespace
#   - no application identity holds the administrator tag
set -eu

: "${CW_VHOST:?CW_VHOST is required}"
: "${CW_INFRA_PASSWORD:?CW_INFRA_PASSWORD is required}"
: "${CATALOG_BROKER_PASSWORD:?CATALOG_BROKER_PASSWORD is required}"
: "${COMMUNICATIONS_BROKER_PASSWORD:?COMMUNICATIONS_BROKER_PASSWORD is required}"
: "${REPORTING_BROKER_PASSWORD:?REPORTING_BROKER_PASSWORD is required}"

rabbitmqctl await_startup

# The well-known default account is never an application identity here.
rabbitmqctl delete_user guest 2>/dev/null || true

rabbitmqctl add_vhost "$CW_VHOST"

add_user() {
  # $1 user, $2 password
  rabbitmqctl add_user "$1" "$2"
  # Explicitly empty tags: no administrator, no monitoring, no policymaker.
  rabbitmqctl set_user_tags "$1"
}

add_user cw_infra_topology "$CW_INFRA_PASSWORD"
add_user cw_catalog_app "$CATALOG_BROKER_PASSWORD"
add_user cw_communications_app "$COMMUNICATIONS_BROKER_PASSWORD"
add_user cw_reporting_app "$REPORTING_BROKER_PASSWORD"

# configure / write / read
rabbitmqctl set_permissions -p "$CW_VHOST" cw_infra_topology '.*' '.*' '.*'

# Producer: owns exactly one exchange. No read permission at all, so it cannot
# consume from anything and cannot bind anything to its exchange.
rabbitmqctl set_permissions -p "$CW_VHOST" cw_catalog_app \
  '^catalog\.events$' '^catalog\.events$' '^$'

# Subscribers: own their namespace; read on the producer exchange is the minimum
# required to create a binding, and grants no ability to publish to it.
rabbitmqctl set_permissions -p "$CW_VHOST" cw_communications_app \
  '^communications\.' '^communications\.' '^(communications\.|catalog\.events$)'
rabbitmqctl set_permissions -p "$CW_VHOST" cw_reporting_app \
  '^reporting\.' '^reporting\.' '^(reporting\.|catalog\.events$)'

echo "rabbitmq acceptance identities provisioned on vhost ${CW_VHOST}"
rabbitmqctl list_permissions -p "$CW_VHOST"
rabbitmqctl list_users
