import { Knex } from 'knex';
import { isMySQL, isPostgres, isSqlite } from '../util/db';

export async function up(knex: Knex): Promise<void> {
    if (isMySQL(knex)) {
        return knex.raw(
            'ALTER TABLE routes ADD domainIdIdxble int(11) GENERATED ALWAYS AS (coalesce(domainId, -1)) STORED;',
        );
    } else if (isPostgres(knex)) {
        return knex.raw(
            'ALTER TABLE "routes" ADD "domainIdIdxble" int GENERATED ALWAYS AS (COALESCE("domainId", -1)) STORED;',
        );
    } else {
        return knex.raw(
            'ALTER TABLE routes ADD COLUMN domainIdIdxble INT GENERATED ALWAYS AS (coalesce(domainId, -1)) VIRTUAL;',
        );
    }
}

export async function down(knex: Knex): Promise<void> {
    return knex.schema.alterTable('routes', (table) => {
        table.dropColumn('domainIdIdxble');

        if (isSqlite(knex)) {
            // SQLite drops "unique" during dropping column, so we need to reset it
            table.unique(['orderPos'], 'routes_orderpos_unique');
            table.unique(['route', 'domainId'], 'routes_route_and_domainId_unique');
        }
    });
}
