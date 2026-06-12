# SPL API notes

Verified on 2026-06-12 against the public National Address API portal.

## Sources checked

- `https://api.address.gov.sa/apidocumentation`
  - Public documentation index lists Address API pages for free text search, fixed search, bulk search, verify an address, address geocode, POI search, nearest POIs, extents, and address by phone.
  - Public documentation index lists Lookups API pages for regions, cities, and districts.
  - It does not list a standalone short-address page.
- `https://splonline.com.sa/en/national-address-api/`
  - SPL's product page says Address API supports retrieving the national address through multiple inputs, including short address.
- `https://api.address.gov.sa/freetextsearch`
  - Documents API host `https://apina.address.gov.sa/NationalAddress`.
  - Documents v3.1 and v4 free-text paths under `/address/address-free-text`.
  - Documents `format`, `language`, `page`, `addressstring`, and `api_key`.
  - Documents address response fields including `Addresses`, `totalSearchResults`, `BuildingNumber`, `Street`, `District`, `City`, `PostCode`, `AdditionalNumber`, `RegionName`, `Latitude`, `Longitude`, `CityId`, `RegionId`, and `DistrictID`.
- `https://api.address.gov.sa/verifyanaddress`
  - Documents official verify path `/v3.1/address/address-verify`.
  - Documents `Buildingnumber`, `Zipcode`, `Additionalnumber`, `format`, `language`, and `api_key`.
  - Documents `addressfound` as the official boolean result.

## Endpoint probes without a live key

The workspace has no `NATIONAL_ADDRESS_API_KEY`, so live success responses were not attempted.

- `https://apina.address.gov.sa/NationalAddress/v3.1/address/address-verify?...&api_key=` returns `401`, which confirms the documented verify route exists and requires a valid subscription key.
- `https://apina.address.gov.sa/NationalAddress/v4/address/address-free-text?...&api_key=` returns `401`, which confirms the documented v4 search route exists and requires a valid subscription key.
- `https://apina.address.gov.sa/NationalAddress/NationalAddressByShortAddress/NationalAddressByShortAddress?shortaddress=RRRD2929&language=E&format=JSON&api_key=` returns a JSON server error rather than `404`, while versioned candidates under `/v3.1/...` and `/v4/...` return `404`.

## Implementation decision

- Base URL: `https://apina.address.gov.sa/NationalAddress`.
- Short-address resolve path: `/NationalAddressByShortAddress/NationalAddressByShortAddress`.
- Official verify path: `/v3.1/address/address-verify`.
- Auth: the public docs name the subscription field `api_key`; the implementation sends it as an `api_key` header so the secret is not placed in request URLs.
- Resolve calls both `language=A` and `language=E` and normalizes only fields that SPL returns.
- Verify uses the documented `addressfound` result.
- The adapter is still opt-in and off without `NATIONAL_ADDRESS_API_KEY`.
- Live-key verification remains deferred until an SPL subscription key is available; the package test suite uses mocked SPL I/O and does not claim live SPL success.
