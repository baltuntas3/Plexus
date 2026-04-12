export type ProviderNameDto = "openai" | "anthropic" | "groq";

export interface ModelInfoDto {
  id: string;
  provider: ProviderNameDto;
  displayName: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface ModelListResponse {
  items: ModelInfoDto[];
}
