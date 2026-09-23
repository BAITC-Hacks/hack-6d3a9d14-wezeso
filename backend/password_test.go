package main

import "testing"

func TestSharedDemoPassword(t *testing.T) {
	t.Setenv("DEMO_PASSWORD", "")
	a := fixture(t)
	if err := a.Store.transact(syncDemoPasswords); err != nil {
		t.Fatal(err)
	}
	for _, user := range a.Store.State.Users {
		expect(t, (testClient{a: a}).do("POST", "login", `{"login":"`+user.Login+`","password":"12345678"}`), 200)
	}
	before := a.Store.State.Users[0].Hash
	if err := syncDemoPasswords(&a.Store.State); err != nil {
		t.Fatal(err)
	}
	if a.Store.State.Users[0].Hash != before {
		t.Fatal("unchanged password was rehashed")
	}
	if _, err := hashPassword("1234567"); err == nil {
		t.Fatal("accepted a password shorter than eight characters")
	}
}
