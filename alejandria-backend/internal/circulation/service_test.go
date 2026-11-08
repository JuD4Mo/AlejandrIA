package circulation

import "testing"

func TestAssignmentAudit(t *testing.T) {
	for _, tc := range []struct {
		name   string
		actor  int64
		origin string
	}{{"automatic", 0, "system"}, {"staff", 19, "manual"}} {
		t.Run(tc.name, func(t *testing.T) {
			origin, actor := assignmentAudit(tc.actor)
			if origin != tc.origin {
				t.Fatal("incorrect audit origin")
			}
			if tc.actor == 0 && actor != nil {
				t.Fatal("system impersonated an actor")
			}
			if tc.actor > 0 && (actor == nil || *actor != tc.actor) {
				t.Fatal("manual actor lost")
			}
		})
	}
}

func TestEligibilityPolicy(t *testing.T) {
	for _, tc := range []struct {
		name    string
		active  bool
		count   int
		overdue bool
		ok      bool
	}{{"eligible", true, 1, false, true}, {"two active", true, 2, false, false}, {"overdue", true, 1, true, false}, {"inactive", false, 0, false, false}} {
		t.Run(tc.name, func(t *testing.T) {
			e := Eligible(tc.active, tc.count, tc.overdue)
			if (e == nil) != tc.ok {
				t.Fatalf("unexpected eligibility: %v", e)
			}
		})
	}
}
