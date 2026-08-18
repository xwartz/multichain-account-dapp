export function toDisplayValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value, (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')}`
  }

  if (Array.isArray(value)) return value.map(toDisplayValue)

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        toDisplayValue(nested),
      ])
    )
  }

  return value
}

export function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.cause ? { cause: toDisplayValue(error.cause) } : {}),
    }
  }

  return { message: String(error), raw: toDisplayValue(error) }
}
