import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import { createContext, useContext, type JSX } from "solid-js";

import { createResource } from "solid-js";
import type { ResourceReturn, ResourceOptions } from "solid-js";

const DuckDBContext =
  // eslint-disable-next-line no-unused-vars
  createContext<ResourceReturn<duckdb.AsyncDuckDB>>();

export function DuckDBProvider(props: { children: JSX.Element }) {
  const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: {
      mainModule: duckdb_wasm,
      mainWorker: mvp_worker,
    },
    eh: {
      mainModule: duckdb_wasm_eh,
      mainWorker: eh_worker,
    },
  };

  const [data, { mutate, refetch }]: ResourceReturn<duckdb.AsyncDuckDB> =
    createResource<duckdb.AsyncDuckDB>(async () => {
      // Select a bundle based on browser checks
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
      // Instantiate the asynchronus version of DuckDB-wasm
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    });
  const setter: ResourceReturn<duckdb.AsyncDuckDB> = [
    data,
    { mutate, refetch },
  ];

  return (
    /* @ts-ignore */
    <DuckDBContext.Provider value={setter}>
      {props.children}
    </DuckDBContext.Provider>
  );
}

export function useDuckDB() {
  const context = useContext(DuckDBContext);
  if (!context) {
    throw new Error("useDuckDB: cannot find a DuckDBContext");
  }
  // eslint-disable-next-line no-unused-vars
  return context as ResourceReturn<duckdb.AsyncDuckDB>;
}
