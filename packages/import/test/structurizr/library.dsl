/*
 * A fictional city library, written to test the Structurizr DSL import.
 */
workspace "City Library" "Lending books online" {

    !identifiers flat

    model {
        reader = person "Reader" "Borrows books and e-books"
        enterprise "City Library" {
            librarian = person "Librarian" "Runs the desk"
            catalogue = softwareSystem "Catalogue" "Finds and lends books" {
                site = container "Website" "Search and loans" "React" "Web Browser"
                api = container "Loans API" "Takes loans and returns" "Kotlin" {
                    loans = component "Loans controller" "Handles loans" "Ktor"
                    stock = component "Stock service" "Knows what is on the shelf" "Kotlin"
                    loans -> stock "Checks availability"
                }
                db = container "Loans database" "Loans and holds" "PostgreSQL" "Database"
                site -> api "Calls" "JSON/HTTPS"
                api -> db "Reads and writes" "JDBC"
            }
        }
        mailer = softwareSystem "Mail service" "Sends reminders" "External"

        reader -> site "Searches and borrows" "HTTPS"
        librarian -> catalogue "Manages stock"
        loans -> mailer "Sends due-date reminders" "SMTP"
        stock -> db "Reads stock"

        live = deploymentEnvironment "Live" {
            deploymentNode "Cloud" "" "Hetzner" {
                deploymentNode "App server" "" "Ubuntu 24.04" "" 2 {
                    containerInstance api
                    containerInstance site
                }
                deploymentNode "Database server" "" "PostgreSQL 16" {
                    containerInstance db
                }
                infrastructureNode "Load balancer" "" "HAProxy"
            }
        }
    }

    views {
        systemLandscape "landscape" {
            include *
            autoLayout lr
        }
        systemContext catalogue "context" {
            include *
            title "Catalogue in context"
        }
        container catalogue "containers" {
            include *
        }
        component api "components" {
            include *
        }
        dynamic api "borrow" "Borrowing a book" {
            site -> loans "Requests a loan"
            loans -> stock "Checks the shelf"
            stock -> db "Marks it lent" "SQL"
        }
        deployment catalogue "Live" "live" {
            include *
        }
        styles {
            element "Person" {
                shape person
            }
        }
        theme default
    }
}
