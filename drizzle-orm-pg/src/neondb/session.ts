import {
	Client,
	Pool,
	PoolClient,
	QueryArrayConfig,
	QueryConfig,
	QueryResult,
	QueryResultRow,
} from '@neondatabase/serverless';
import { Logger, NoopLogger } from 'drizzle-orm';
import { fillPlaceholders, Query } from 'drizzle-orm/sql';
import { mapResultRow } from 'drizzle-orm/utils';
import { PgDialect } from '~/dialect';
import { SelectFieldsOrdered } from '~/operations';
import { PgSession, PreparedQuery, PreparedQueryConfig } from '~/session';

export type NeonClient = Pool | PoolClient | Client;

export class NeonPreparedQuery<T extends PreparedQueryConfig> extends PreparedQuery<T> {
	private rawQuery: QueryConfig;
	private query: QueryArrayConfig;

	constructor(
		private client: NeonClient,
		queryString: string,
		private params: unknown[],
		private logger: Logger,
		private fields: SelectFieldsOrdered | undefined,
		name: string | undefined,
	) {
		super();
		this.rawQuery = {
			name,
			text: queryString,
		};
		this.query = {
			name,
			text: queryString,
			rowMode: 'array',
		};
	}

	execute(placeholderValues: Record<string, unknown> | undefined = {}): Promise<T['execute']> {
		const params = fillPlaceholders(this.params, placeholderValues);

		this.logger.logQuery(this.rawQuery.text, params);

		const { fields } = this;
		if (!fields) {
			return this.client.query(this.rawQuery, params);
		}

		const result = this.client.query(this.query, params);

		return result.then((result) => result.rows.map((row) => mapResultRow<T['execute']>(fields, row)));
	}

	all(placeholderValues: Record<string, unknown> | undefined = {}): Promise<T['all']> {
		const params = fillPlaceholders(this.params, placeholderValues);
		this.logger.logQuery(this.rawQuery.text, params);
		return this.client.query(this.rawQuery, params).then((result) => result.rows);
	}

	values(placeholderValues: Record<string, unknown> | undefined = {}): Promise<T['values']> {
		const params = fillPlaceholders(this.params, placeholderValues);
		this.logger.logQuery(this.rawQuery.text, params);
		return this.client.query(this.query, params).then((result) => result.rows);
	}
}

export interface NeonSessionOptions {
	logger?: Logger;
}

export class NeonSession extends PgSession {
	private logger: Logger;

	constructor(
		private client: NeonClient,
		dialect: PgDialect,
		options: NeonSessionOptions = {},
	) {
		super(dialect);
		this.logger = options.logger ?? new NoopLogger();
	}

	prepareQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
		query: Query,
		fields: SelectFieldsOrdered | undefined,
		name: string | undefined,
	): PreparedQuery<T> {
		return new NeonPreparedQuery(this.client, query.sql, query.params, this.logger, fields, name);
	}

	async query(query: string, params: unknown[]): Promise<QueryResult> {
		this.logger.logQuery(query, params);
		const result = await this.client.query({
			rowMode: 'array',
			text: query,
			values: params,
		});
		return result;
	}

	async queryObjects<T extends QueryResultRow>(
		query: string,
		params: unknown[],
	): Promise<QueryResult<T>> {
		return this.client.query<T>(query, params);
	}
}