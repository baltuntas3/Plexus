import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { DomainError } from "../../../domain/errors/domain-error.js";
import { logger } from "../../../infrastructure/logger/logger.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: { issues: err.issues },
      },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL", message: "Internal server error" },
  });
};
