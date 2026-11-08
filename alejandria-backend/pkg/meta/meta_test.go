package meta

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestParsePreservesLimitOffsetContract(t *testing.T) {
	for _, tc := range []struct {
		name, query   string
		limit, offset int
		ok            bool
	}{{"defaults", "", 20, 0, true}, {"range", "limit=5&offset=7", 5, 7, true}, {"invalid limit", "limit=101", 0, 0, false}, {"invalid offset", "offset=-1", 0, 0, false}, {"non numeric", "limit=no", 0, 0, false}} {
		t.Run(tc.name, func(t *testing.T) {
			values, _ := url.ParseQuery(tc.query)
			p, err := Parse(values)
			if (err == nil) != tc.ok {
				t.Fatalf("validation: %v", err)
			}
			if !tc.ok {
				return
			}
			if p.Limit != tc.limit || p.Offset != tc.offset {
				t.Fatal("changed pagination")
			}
			raw, _ := json.Marshal(p)
			var out map[string]int
			_ = json.Unmarshal(raw, &out)
			if len(out) != 2 {
				t.Fatal("changed response shape")
			}
		})
	}
}
func TestMetaUsesSharedDefault(t *testing.T) {
	m, err := New(2, 0, 41)
	if err != nil {
		t.Fatal(err)
	}
	if m.Limit != DefaultLimit || m.Offset() != 20 || m.TotalPages != 3 {
		t.Fatal("metadata calculation")
	}
}
