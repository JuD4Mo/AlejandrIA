package errs

import (
	"net/http"
)

func NewUnauthorizedError(message string, override bool) *HTTPError {
	return &HTTPError{
		Code:     MakeUpperCaseWithUnderscores(http.StatusText(http.StatusUnauthorized)),
		Message:  message,
		Status:   http.StatusUnauthorized,
		Override: override,
	}
}

func NewForbiddenError(message string, override bool) *HTTPError {
	return &HTTPError{
		Code:     MakeUpperCaseWithUnderscores(http.StatusText(http.StatusForbidden)),
		Message:  message,
		Status:   http.StatusForbidden,
		Override: override,
	}
}

func NewConflictError(message string, override bool) *HTTPError {
	return &HTTPError{Code: MakeUpperCaseWithUnderscores(http.StatusText(http.StatusConflict)), Message: message, Status: http.StatusConflict, Override: override}
}

func NewServiceUnavailableError(message string) *HTTPError {
	return &HTTPError{Code: "SERVICE_UNAVAILABLE", Message: message, Status: http.StatusServiceUnavailable}
}
func NewGatewayTimeoutError(message string) *HTTPError {
	return &HTTPError{Code: "GATEWAY_TIMEOUT", Message: message, Status: http.StatusGatewayTimeout}
}
func NewBadGatewayError(message string) *HTTPError {
	return &HTTPError{Code: "BAD_GATEWAY", Message: message, Status: http.StatusBadGateway}
}

func NewBadRequestError(message string, override bool, code *string, errors []FieldError, action *Action) *HTTPError {
	formattedCode := MakeUpperCaseWithUnderscores(http.StatusText(http.StatusBadRequest))

	if code != nil {
		formattedCode = *code
	}

	return &HTTPError{
		Code:     formattedCode,
		Message:  message,
		Status:   http.StatusBadRequest,
		Override: override,
		Errors:   errors,
		Action:   action,
	}
}

func NewNotFoundError(message string, override bool, code *string) *HTTPError {
	formattedCode := MakeUpperCaseWithUnderscores(http.StatusText(http.StatusNotFound))

	if code != nil {
		formattedCode = *code
	}

	return &HTTPError{
		Code:     formattedCode,
		Message:  message,
		Status:   http.StatusNotFound,
		Override: override,
	}
}

func NewInternalServerError() *HTTPError {
	return &HTTPError{
		Code:     MakeUpperCaseWithUnderscores(http.StatusText(http.StatusInternalServerError)),
		Message:  http.StatusText(http.StatusInternalServerError),
		Status:   http.StatusInternalServerError,
		Override: false,
	}
}

func ValidationError(err error) *HTTPError {
	return NewBadRequestError("Validation failed: "+err.Error(), false, nil, nil, nil)
}
