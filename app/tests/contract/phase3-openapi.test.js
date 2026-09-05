import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

const specificationPath = new URL("../../server/openapi.yaml", import.meta.url);

test("OpenAPI documents every PHASE 3 core-loop operation", async () => {
  const specification = parse(await readFile(specificationPath, "utf8"));
  const expectedOperations = {
    "/inspirations": ["get", "post"],
    "/inspirations/{id}": ["get", "patch"],
    "/inspirations/{id}/convert": ["post"],
    "/contents": ["get", "post"],
    "/contents/{id}": ["get", "patch"],
    "/dashboard": ["get"]
  };

  for (const [path, methods] of Object.entries(expectedOperations)) {
    assert.ok(specification.paths[path], `${path} must be documented`);
    for (const method of methods) {
      assert.ok(specification.paths[path][method]?.operationId, `${method.toUpperCase()} ${path} needs an operationId`);
      assert.ok(specification.paths[path][method].responses["200"] || specification.paths[path][method].responses["201"]);
    }
  }
});

test("OpenAPI exposes idempotency, optimistic locking and stable conflict errors", async () => {
  const specification = parse(await readFile(specificationPath, "utf8"));

  for (const [path, method] of [["/inspirations", "post"], ["/inspirations/{id}/convert", "post"], ["/contents", "post"]]) {
    const parameters = specification.paths[path][method].parameters ?? [];
    assert.ok(parameters.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), `${method.toUpperCase()} ${path} requires Idempotency-Key`);
  }

  for (const [path, method] of [["/inspirations/{id}", "patch"], ["/contents/{id}", "patch"]]) {
    const operation = specification.paths[path][method];
    assert.equal(operation.responses["409"].$ref, "#/components/responses/VersionConflict");
  }
  assert.equal(
    specification.paths["/inspirations/{id}/convert"].post.responses["409"].$ref,
    "#/components/responses/ConversionConflict"
  );

  assert.ok(specification.components.schemas.Inspiration);
  assert.ok(specification.components.schemas.Content);
  assert.ok(specification.components.schemas.Dashboard);
  assert.ok(specification.components.schemas.Publication);
});
